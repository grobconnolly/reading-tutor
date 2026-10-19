/**
 * Runs the real migrations against an in-process Postgres (PGlite) with a stub of Supabase's
 * auth schema and roles, then checks that a second parent account cannot read or write the
 * first parent's rows. This is the automated form of acceptance check "RLS blocks a second
 * test parent account from reading either girl's rows". See scripts/rls-live-check.mjs for the
 * same check against a hosted project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PASSAGES } from "../passages";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

/** Run `fn` as the `authenticated` role with auth.uid() = user (or anon when null), then reset. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function readerIds(parent: string): Promise<{ id: string; name: string }[]> {
  return rows<{ id: string; name: string }>("select id, name from public.readers where parent_id = $1 order by grade desc", [parent]);
}

beforeAll(async () => {
  db = new PGlite();
  // What a Supabase project provides before our migrations run.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  const dir = join(__dirname, "..", "..", "..", "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("seed", () => {
  it("creates a profile and Stella (grade 5, level 3) + Penny (grade 3, level 2) for each new parent", async () => {
    const profiles = await rows("select id from public.profiles order by id");
    expect(profiles.map((p) => p.id)).toEqual([A, B]);
    const r = await rows<{ name: string; grade: number; level: number; start_level: number; reward_kind: string; weekly_reward_cents: number; reward_label: string | null }>(
      "select name, grade, level, start_level, reward_kind, weekly_reward_cents, reward_label from public.readers where parent_id = $1 order by grade desc", [A]);
    expect(r).toEqual([
      { name: "Stella", grade: 5, level: 3, start_level: 3, reward_kind: "cash", weekly_reward_cents: 500, reward_label: null },
      { name: "Penny", grade: 3, level: 2, start_level: 2, reward_kind: "cash", weekly_reward_cents: 500, reward_label: null },
    ]);
    expect((await readerIds(B)).length).toBe(2);
  });
  it("a reader created outside the seed starts as a prize reward the parent names, and can choose cash", async () => {
    const [made] = await as(A, () => rows<{ reward_kind: string; reward_label: string | null }>(
      "insert into public.readers (parent_id, name, grade) values ($1, 'Cousin', 4) returning reward_kind, reward_label", [A]));
    expect(made).toEqual({ reward_kind: "prize", reward_label: null });
    const upd = await as(A, () => db.query("update public.readers set reward_kind = 'cash', weekly_reward_cents = 300, reward_label = null where name = 'Cousin' and parent_id = $1", [A]));
    expect(upd.affectedRows).toBe(1);
    await expect(as(A, () => db.query("update public.readers set reward_kind = 'candy' where name = 'Cousin'"))).rejects.toThrow(/check constraint/);
    const del = await as(A, () => db.query("delete from public.readers where name = 'Cousin' and parent_id = $1", [A]));
    expect(del.affectedRows).toBe(1);
  });
  it("seeds exactly the library passages from src/lib/passages.ts (re-run `npm run seed:passages` after editing it)", async () => {
    const seeded = await rows<{ id: string; level: number; title: string; text: string; questions: unknown }>(
      "select id, level, title, text, questions from public.passages where source = 'library' order by id");
    const expected = PASSAGES.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => ({ id: p.id, level: p.level, title: p.title, text: p.text, questions: p.questions }));
    expect(seeded).toEqual(expected);
    const perLevel = await rows<{ level: number; n: number }>("select level, count(*)::int as n from public.passages where source = 'library' group by level order by level");
    expect(perLevel.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const r of perLevel) expect(r.n).toBeGreaterThanOrEqual(2);
  });
});

describe("row level security between two parent accounts", () => {
  it("each parent sees only their own profile and readers", async () => {
    const mine = await as(A, () => rows<{ id: string }>("select id, parent_pin_set from public.profiles"));
    expect(mine.map((p) => p.id)).toEqual([A]);
    const readers = await as(A, () => rows<{ parent_id: string }>("select id, parent_id, name, pin_set, level from public.readers"));
    expect(readers).toHaveLength(2);
    expect(readers.every((r) => r.parent_id === A)).toBe(true);
    const none = await as(A, () => rows("select id from public.readers where parent_id = $1", [B]));
    expect(none).toEqual([]);
  });

  it("the anon key sees nothing", async () => {
    await expect(as(null, () => rows("select id from public.readers"))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => rows("select id from public.passages"))).rejects.toThrow(/permission denied/);
  });

  it("PIN hashes are never readable, even on your own rows", async () => {
    await expect(as(A, () => rows("select pin_hash from public.readers"))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => rows("select * from public.readers"))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => rows("select parent_pin_hash from public.profiles"))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query("update public.readers set pin_hash = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => rows("select * from public.pin_attempts"))).rejects.toThrow(/permission denied/);
  });

  it("a parent cannot change the other parent's readers", async () => {
    const [bStella] = await readerIds(B);
    const res = await as(A, () => db.query("update public.readers set level = 7 where id = $1", [bStella.id]));
    expect(res.affectedRows).toBe(0);
    const [{ level }] = await rows<{ level: number }>("select level from public.readers where id = $1", [bStella.id]);
    expect(level).toBe(3);
    const own = await as(A, async () => db.query("update public.readers set level = 4, interests = 'dogs' where id = $1", [(await readerIds(A))[0].id]));
    expect(own.affectedRows).toBe(1);
  });

  it("sessions, trouble words, baselines and reward weeks are invisible across accounts", async () => {
    const [aStella] = await readerIds(A);
    const [bStella] = await readerIds(B);
    await as(A, () => db.query(
      `insert into public.sessions (reader_id, passage_id, mode, started_at, ended_at, words_total, words_attempted, words_correct, accuracy, wcpm, comp_right, comp_total, missed_words, counts_for_goal, stars)
       values ($1, '3a', 'practice', now() - interval '2 minutes', now(), 100, 100, 95, 0.95, 80, 3, 3, '{"zoomed"}', true, 3)`, [aStella.id]));
    await as(A, () => db.query("select public.record_trouble_words($1, '{\"zoomed\",\"pitch\"}', '{}')", [aStella.id]));
    await as(A, () => db.query("insert into public.baselines (reader_id, level, wcpm, passage_ids) values ($1, 3, 80, '{\"3a\"}')", [aStella.id]));
    await as(A, () => db.query("insert into public.reward_weeks (reader_id, week_start, stories, earned) values ($1, '2026-10-19', 1, false)", [aStella.id]));

    // A sees her rows.
    expect(await as(A, () => rows("select id from public.sessions"))).toHaveLength(1);
    expect(await as(A, () => rows("select word from public.trouble_words"))).toHaveLength(2);
    expect(await as(A, () => rows("select id from public.baselines"))).toHaveLength(1);
    expect(await as(A, () => rows("select week_start from public.reward_weeks"))).toHaveLength(1);

    // B sees none of them, even when asking for A's reader by id.
    for (const t of ["sessions", "trouble_words", "baselines", "reward_weeks"]) {
      expect(await as(B, () => rows(`select reader_id from public.${t}`))).toEqual([]);
      expect(await as(B, () => rows(`select reader_id from public.${t} where reader_id = $1`, [aStella.id]))).toEqual([]);
    }

    // B cannot write rows for A's reader.
    await expect(as(B, () => db.query(
      `insert into public.sessions (reader_id, passage_id, mode, started_at, ended_at, words_total, words_attempted, words_correct, accuracy, comp_right, comp_total)
       values ($1, '3a', 'practice', now(), now(), 10, 10, 10, 1, 3, 3)`, [aStella.id]))).rejects.toThrow(/row-level security/);
    await expect(as(B, () => db.query("select public.record_trouble_words($1, '{\"x\"}', '{}')", [aStella.id]))).rejects.toThrow(/does not belong/);
    await expect(as(B, () => db.query("insert into public.reward_weeks (reader_id, week_start) values ($1, '2026-10-19')", [aStella.id]))).rejects.toThrow(/row-level security/);
    expect((await as(B, () => db.query("update public.sessions set stars = 0 where reader_id = $1", [aStella.id]))).affectedRows).toBe(0);
    expect((await as(B, () => db.query("delete from public.sessions where reader_id = $1", [aStella.id]))).affectedRows).toBe(0);

    // B can write for her own reader.
    await as(B, () => db.query("select public.record_trouble_words($1, '{\"zoomed\"}', '{}')", [bStella.id]));
    expect(await as(B, () => rows("select word from public.trouble_words"))).toEqual([{ word: "zoomed" }]);

    // Nothing leaked: A still sees exactly her own trouble words.
    expect(await as(A, () => rows("select word from public.trouble_words order by word"))).toEqual([{ word: "pitch" }, { word: "zoomed" }]);
  });

  it("record_trouble_words increments misses and wins and lowercases", async () => {
    const [, aPenny] = await readerIds(A);
    await as(A, () => db.query("select public.record_trouble_words($1, '{\"Garden\",\"garden\",\"shoot\"}', '{\"shoot\"}')", [aPenny.id]));
    await as(A, () => db.query("select public.record_trouble_words($1, '{}', '{\"garden\"}')", [aPenny.id]));
    const r = await as(A, () => rows<{ word: string; misses: number; wins: number }>(
      "select word, misses, wins from public.trouble_words where reader_id = $1 order by word", [aPenny.id]));
    expect(r).toEqual([
      { word: "garden", misses: 1, wins: 1 },
      { word: "shoot", misses: 1, wins: 1 },
    ]);
  });

  it("library passages are shared; AI passages belong to one reader", async () => {
    const [aStella] = await readerIds(A);
    await as(A, () => db.query(
      "insert into public.passages (id, level, title, text, questions, source, reader_id) values ('ai-a-1', 3, 'Dogs', 'A dog.', '[]', 'ai', $1)", [aStella.id]));
    expect(await as(A, () => rows("select id from public.passages where source = 'ai'"))).toEqual([{ id: "ai-a-1" }]);
    expect(await as(B, () => rows("select id from public.passages where source = 'ai'"))).toEqual([]);
    expect((await as(B, () => rows("select id from public.passages where source = 'library'"))).length).toBe(PASSAGES.length);
    // Nobody can plant an AI passage on someone else's reader or edit the library.
    await expect(as(B, () => db.query(
      "insert into public.passages (id, level, title, text, questions, source, reader_id) values ('ai-b-x', 3, 'X', 'X.', '[]', 'ai', $1)", [aStella.id]))).rejects.toThrow(/row-level security/);
    expect((await as(B, () => db.query("update public.passages set title = 'hacked' where id = '1a'"))).affectedRows).toBe(0);
  });

  it("deleting a parent removes everything under them", async () => {
    await db.exec(`insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'c@example.com');`);
    expect((await readerIds("33333333-3333-4333-8333-333333333333")).length).toBe(2);
    await db.exec(`delete from auth.users where id = '33333333-3333-4333-8333-333333333333';`);
    expect((await readerIds("33333333-3333-4333-8333-333333333333")).length).toBe(0);
    expect(await rows("select id from public.profiles where id = '33333333-3333-4333-8333-333333333333'")).toEqual([]);
  });
});
