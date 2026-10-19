-- Milestone 2: parent accounts, reader profiles, passages, sessions, trouble words,
-- baselines, reward weeks. Row Level Security on every table: a parent can read and
-- write only rows that belong to their own readers.
--
-- Run with `supabase db push` (after `supabase init` + `supabase link`) or paste into
-- the SQL editor of the hosted project. Safe to run on a fresh project.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per parent account. id = auth.users.id.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  parent_pin_hash  text,
  -- Readable flag so the app can tell whether the PIN is set without seeing the hash.
  parent_pin_set   boolean generated always as (parent_pin_hash is not null) stored,
  created_at       timestamptz not null default now()
);

create table public.readers (
  id                   uuid primary key default gen_random_uuid(),
  parent_id            uuid not null references public.profiles (id) on delete cascade,
  name                 text not null,
  pin_hash             text,
  pin_set              boolean generated always as (pin_hash is not null) stored,
  grade                int not null check (grade between 1 and 12),
  interests            text not null default '',
  level                int not null default 3 check (level between 1 and 7),
  -- Level the reading check begins at. Adjustable in the parent dashboard.
  start_level          int not null default 3 check (start_level between 1 and 7),
  weekly_goal          int not null default 5 check (weekly_goal between 1 and 14),
  weekly_reward_cents  int not null default 500 check (weekly_reward_cents between 0 and 100000),
  -- The parent's choice of reward: cash (weekly_reward_cents) or a prize described in reward_label.
  -- The seeded readers are cash; any other newly created reader starts as a prize the parent names.
  reward_kind          text not null default 'prize' check (reward_kind in ('cash', 'prize')),
  reward_label         text,
  -- The baseline the dashboard shows. Null until a reading check is done, or after "Re-run reading check".
  current_baseline_id  uuid,
  created_at           timestamptz not null default now()
);
create index readers_parent_idx on public.readers (parent_id);

create table public.passages (
  id          text primary key,
  level       int not null check (level between 1 and 7),
  title       text not null,
  text        text not null,
  -- [{ "q": "...", "options": ["correct", "wrong", "wrong", "wrong"], "a": 0 }]
  questions   jsonb not null,
  source      text not null check (source in ('library', 'ai')),
  -- Null for library passages; the owning reader for AI-written ones.
  reader_id   uuid references public.readers (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check ((source = 'library') = (reader_id is null))
);
create index passages_reader_idx on public.passages (reader_id);

create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  reader_id        uuid not null references public.readers (id) on delete cascade,
  passage_id       text not null references public.passages (id),
  mode             text not null check (mode in ('check', 'practice')),
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  words_total      int not null check (words_total >= 0),
  words_attempted  int not null check (words_attempted >= 0),
  words_correct    int not null check (words_correct >= 0),
  -- 0..1
  accuracy         numeric(5, 4) not null check (accuracy between 0 and 1),
  wcpm             int check (wcpm is null or wcpm >= 0),
  comp_right       int not null check (comp_right >= 0),
  comp_total       int not null check (comp_total >= 0),
  helped_words     text[] not null default '{}',
  missed_words     text[] not null default '{}',
  -- Milestone 3: Azure accuracy / fluency / completeness scores.
  azure_scores     jsonb,
  counts_for_goal  boolean not null default false,
  stars            int not null default 0 check (stars between 0 and 3),
  created_at       timestamptz not null default now()
);
create index sessions_reader_ended_idx on public.sessions (reader_id, ended_at);

create table public.trouble_words (
  reader_id  uuid not null references public.readers (id) on delete cascade,
  word       text not null,
  misses     int not null default 0 check (misses >= 0),
  wins       int not null default 0 check (wins >= 0),
  last_seen  timestamptz not null default now(),
  primary key (reader_id, word)
);

create table public.baselines (
  id           uuid primary key default gen_random_uuid(),
  reader_id    uuid not null references public.readers (id) on delete cascade,
  date         timestamptz not null default now(),
  level        int not null check (level between 1 and 7),
  wcpm         int,
  passage_ids  text[] not null default '{}'
);
create index baselines_reader_idx on public.baselines (reader_id);

alter table public.readers
  add constraint readers_current_baseline_fk
  foreign key (current_baseline_id) references public.baselines (id) on delete set null;

-- One row per reader per Monday-to-Sunday week (America/Los_Angeles) with at least one counted story.
create table public.reward_weeks (
  reader_id    uuid not null references public.readers (id) on delete cascade,
  week_start   date not null,
  stories      int not null default 0 check (stories >= 0),
  earned       boolean not null default false,
  paid_at      timestamptz,
  -- Milestone 6: set when the Brevo goal notification has gone out.
  notified_at  timestamptz,
  primary key (reader_id, week_start)
);

-- Rate limiting for POST /api/verify-pin: one row per attempt. Only the service role touches it.
create table public.pin_attempts (
  id            bigint generated always as identity primary key,
  key           text not null,
  attempted_at  timestamptz not null default now()
);
create index pin_attempts_key_time_idx on public.pin_attempts (key, attempted_at);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Does the reader belong to the signed-in parent? Runs as the caller, so RLS on readers applies.
create or replace function public.is_my_reader(r uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.readers where id = r and parent_id = auth.uid()
  );
$$;

-- misses++ for each word in p_missed, wins++ for each word in p_won. Used by POST /api/sessions
-- and by standalone tricky-word practice. Runs as the caller, so RLS applies to the writes too.
create or replace function public.record_trouble_words(p_reader_id uuid, p_missed text[], p_won text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_my_reader(p_reader_id) then
    raise exception 'reader does not belong to this account' using errcode = '42501';
  end if;
  insert into public.trouble_words (reader_id, word, misses, wins, last_seen)
  select p_reader_id, w, 1, 0, now()
  from (select distinct lower(trim(x)) as w from unnest(coalesce(p_missed, '{}')) as x) t
  where w <> ''
  on conflict (reader_id, word) do update
    set misses = public.trouble_words.misses + 1, last_seen = now();
  insert into public.trouble_words (reader_id, word, misses, wins, last_seen)
  select p_reader_id, w, 0, 1, now()
  from (select distinct lower(trim(x)) as w from unnest(coalesce(p_won, '{}')) as x) t
  where w <> ''
  on conflict (reader_id, word) do update
    set wins = public.trouble_words.wins + 1, last_seen = now();
end;
$$;

-- Seed: every new parent account gets a profile plus Stella (grade 5, level 3) and
-- Penny (grade 3, level 2). PINs and interests are set in the app on first run.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.readers (parent_id, name, grade, level, start_level, reward_kind, weekly_reward_cents)
  values
    (new.id, 'Stella', 5, 3, 3, 'cash', 500),
    (new.id, 'Penny',  3, 2, 2, 'cash', 500);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for a parent who signed in before this migration ran.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

insert into public.readers (parent_id, name, grade, level, start_level, reward_kind, weekly_reward_cents)
select p.id, r.name, r.grade, r.level, r.level, 'cash', 500
from public.profiles p
cross join (values ('Stella', 5, 3), ('Penny', 3, 2)) as r (name, grade, level)
where not exists (select 1 from public.readers x where x.parent_id = p.id);

-- ---------------------------------------------------------------------------
-- Privileges. The anon key never reads or writes these tables; signed-in parents
-- get column-level access that leaves the PIN hashes out. Only the service role
-- (server-side routes) can read or write pin_hash, parent_pin_hash and pin_attempts.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles, public.readers, public.passages, public.sessions,
  public.trouble_words, public.baselines, public.reward_weeks, public.pin_attempts
  from anon, authenticated;

grant select (id, parent_pin_set, created_at) on public.profiles to authenticated;

grant select (id, parent_id, name, pin_set, grade, interests, level, start_level, weekly_goal,
              weekly_reward_cents, reward_kind, reward_label, current_baseline_id, created_at)
  on public.readers to authenticated;
grant update (name, grade, interests, level, start_level, weekly_goal, weekly_reward_cents, reward_kind, reward_label, current_baseline_id)
  on public.readers to authenticated;
grant insert (parent_id, name, grade, interests, level, start_level, weekly_goal, weekly_reward_cents, reward_kind, reward_label)
  on public.readers to authenticated;
grant delete on public.readers to authenticated;

grant select, insert, update, delete on public.passages, public.sessions, public.trouble_words,
  public.baselines, public.reward_weeks to authenticated;

revoke execute on function public.is_my_reader(uuid) from public, anon;
grant execute on function public.is_my_reader(uuid) to authenticated, service_role;
revoke execute on function public.record_trouble_words(uuid, text[], text[]) from public, anon;
grant execute on function public.record_trouble_words(uuid, text[], text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.readers       enable row level security;
alter table public.passages      enable row level security;
alter table public.sessions      enable row level security;
alter table public.trouble_words enable row level security;
alter table public.baselines     enable row level security;
alter table public.reward_weeks  enable row level security;
alter table public.pin_attempts  enable row level security;  -- no policies: service role only

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "readers: read own" on public.readers
  for select to authenticated using (parent_id = auth.uid());
create policy "readers: insert own" on public.readers
  for insert to authenticated with check (parent_id = auth.uid());
create policy "readers: update own" on public.readers
  for update to authenticated using (parent_id = auth.uid()) with check (parent_id = auth.uid());
create policy "readers: delete own" on public.readers
  for delete to authenticated using (parent_id = auth.uid());

-- Library passages are shared; AI passages belong to one reader.
create policy "passages: read library or own" on public.passages
  for select to authenticated using (reader_id is null or public.is_my_reader(reader_id));
create policy "passages: insert own ai" on public.passages
  for insert to authenticated with check (source = 'ai' and reader_id is not null and public.is_my_reader(reader_id));
create policy "passages: update own ai" on public.passages
  for update to authenticated using (reader_id is not null and public.is_my_reader(reader_id))
  with check (source = 'ai' and reader_id is not null and public.is_my_reader(reader_id));
create policy "passages: delete own ai" on public.passages
  for delete to authenticated using (reader_id is not null and public.is_my_reader(reader_id));

create policy "sessions: own readers" on public.sessions
  for all to authenticated using (public.is_my_reader(reader_id)) with check (public.is_my_reader(reader_id));
create policy "trouble_words: own readers" on public.trouble_words
  for all to authenticated using (public.is_my_reader(reader_id)) with check (public.is_my_reader(reader_id));
create policy "baselines: own readers" on public.baselines
  for all to authenticated using (public.is_my_reader(reader_id)) with check (public.is_my_reader(reader_id));
create policy "reward_weeks: own readers" on public.reward_weeks
  for all to authenticated using (public.is_my_reader(reader_id)) with check (public.is_my_reader(reader_id));
