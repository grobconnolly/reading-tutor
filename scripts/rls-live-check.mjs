// Manual acceptance check against a hosted Supabase project: a second parent account cannot read or
// write the first parent's rows. Creates a throwaway parent with the service role, signs in as it with
// the anon key, tries to reach the real parent's readers and sessions, then deletes the throwaway user.
//
//   npm run rls:live -- rob@example.com      (the real parent's email)
//
// Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from the
// environment or .env.local. Nothing is printed except pass/fail lines.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const { PASSAGES } = await import(resolve(process.cwd(), "src/lib/passages.ts"));

function envFile(name) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, "");
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const env = { ...envFile(".env.local"), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY;
const parentEmail = process.argv[2];
if (!url || !anon || !service || !parentEmail) {
  console.error("usage: node scripts/rls-live-check.mjs <real-parent-email>   (needs the three Supabase vars in .env.local)");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };

// The real parent and her readers, via the service role.
const { data: users, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (uErr) throw uErr;
const parent = users.users.find((u) => u.email?.toLowerCase() === parentEmail.toLowerCase());
if (!parent) { console.error(`No auth user with email ${parentEmail}. Sign in once first.`); process.exit(2); }
const { data: realReaders } = await admin.from("readers").select("id, name").eq("parent_id", parent.id);
check(realReaders?.length === 2, `real parent has 2 readers (${(realReaders ?? []).map((r) => r.name).join(", ")})`);
const realIds = (realReaders ?? []).map((r) => r.id);

// A throwaway second parent.
const email = `rls-check-${Date.now()}@example.com`;
const password = `Check-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cErr) throw cErr;
try {
  const other = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: sErr } = await other.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;

  const { data: mine } = await other.from("readers").select("id, parent_id, name");
  check(mine?.length === 2 && mine.every((r) => r.parent_id === created.user.id), "second parent sees exactly her own 2 seeded readers");
  const { data: theirs } = await other.from("readers").select("id").in("id", realIds);
  check((theirs ?? []).length === 0, "second parent cannot read the real parent's readers by id");
  for (const t of ["sessions", "trouble_words", "baselines", "reward_weeks"]) {
    const { data, error } = await other.from(t).select("reader_id").in("reader_id", realIds);
    check(!error && (data ?? []).length === 0, `second parent reads 0 rows of ${t} for the real readers`);
  }
  const { data: upd } = await other.from("readers").update({ level: 7 }).in("id", realIds).select("id");
  check((upd ?? []).length === 0, "second parent cannot update the real parent's readers");
  const { error: insErr } = await other.from("sessions").insert({
    reader_id: realIds[0], passage_id: "1a", mode: "practice", started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    words_total: 1, words_attempted: 1, words_correct: 1, accuracy: 1, comp_right: 0, comp_total: 0,
  });
  check(!!insErr, "second parent cannot insert a session for a real reader");
  const { error: hashErr } = await other.from("readers").select("pin_hash");
  check(!!hashErr, "pin_hash is not readable with the anon key");
  const { error: rpcErr } = await other.rpc("record_trouble_words", { p_reader_id: realIds[0], p_missed: ["x"], p_won: [] });
  check(!!rpcErr, "record_trouble_words refuses another parent's reader");
  const { data: lib } = await other.from("passages").select("id").eq("source", "library");
  const libIds = new Set((lib ?? []).map((p) => p.id));
  const missing = PASSAGES.filter((p) => !libIds.has(p.id)).map((p) => p.id);
  check(missing.length === 0, `library passages are readable and match src/lib/passages.ts (${PASSAGES.length}${missing.length ? `; missing ${missing.join(", ")}: re-run the seed migration` : ""})`);
} finally {
  await admin.auth.admin.deleteUser(created.user.id);
  console.log("cleaned up the throwaway parent");
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll RLS checks passed.");
process.exit(failures ? 1 : 0);
