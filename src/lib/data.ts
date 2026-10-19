/* Browser-side reads and writes. Reads and plain writes go straight to Supabase under Row Level Security;
 * anything involving a PIN or a finished session goes through the API routes. */

import { buildAppState, rowToBaseline } from "@/lib/db/mapping";
import { BASELINE_COLUMNS, PASSAGE_COLUMNS, READER_COLUMNS, REWARD_WEEK_COLUMNS, SESSION_COLUMNS, TROUBLE_COLUMNS, type BaselineRow, type PassageRow, type ProfileRow, type ReaderRow, type RewardWeekRow, type SessionRow, type TroubleRow } from "@/lib/db/types";
import type { SaveSessionResult, SessionPayload } from "@/lib/sessionSave";
import type { AppState } from "@/lib/store";
import { supabaseBrowser } from "@/lib/supabase/client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Try again.";
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Couldn't load ${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown as T)) as T;
}

/** Everything for the signed-in parent, in one round of parallel queries. */
export async function loadAppState(): Promise<AppState> {
  const sb = supabaseBrowser();
  const [profile, readers, passages, sessions, trouble, baselines, rewardWeeks] = await Promise.all([
    sb.from("profiles").select("id, parent_pin_set").maybeSingle<ProfileRow>(),
    sb.from("readers").select(READER_COLUMNS).order("grade", { ascending: false }).order("name").returns<ReaderRow[]>(),
    sb.from("passages").select(PASSAGE_COLUMNS).eq("source", "ai").returns<PassageRow[]>(),
    sb.from("sessions").select(SESSION_COLUMNS).order("ended_at").returns<SessionRow[]>(),
    sb.from("trouble_words").select(TROUBLE_COLUMNS).returns<TroubleRow[]>(),
    sb.from("baselines").select(BASELINE_COLUMNS).returns<BaselineRow[]>(),
    sb.from("reward_weeks").select(REWARD_WEEK_COLUMNS).returns<RewardWeekRow[]>(),
  ]);
  if (profile.error) throw new Error(`Couldn't load the parent profile: ${profile.error.message}`);
  return buildAppState({
    profile: profile.data,
    readers: must(readers, "readers"),
    passages: must(passages, "passages"),
    sessions: must(sessions, "sessions"),
    trouble: must(trouble, "trouble words"),
    baselines: must(baselines, "baselines"),
    rewardWeeks: must(rewardWeeks, "reward weeks"),
  });
}

export interface ReaderFields {
  interests?: string;
  level?: number;
  startLevel?: number;
  goal?: number;
  reward?: number;
  rewardKind?: "cash" | "prize";
  rewardLabel?: string;
}

export async function updateReaderFields(readerId: string, f: ReaderFields): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (f.interests !== undefined) patch.interests = f.interests;
  if (f.level !== undefined) patch.level = f.level;
  if (f.startLevel !== undefined) patch.start_level = f.startLevel;
  if (f.goal !== undefined) patch.weekly_goal = f.goal;
  if (f.reward !== undefined) patch.weekly_reward_cents = Math.round(f.reward * 100);
  if (f.rewardKind !== undefined) patch.reward_kind = f.rewardKind;
  if (f.rewardLabel !== undefined) patch.reward_label = f.rewardLabel.trim() || null;
  if (!Object.keys(patch).length) return;
  const { error } = await supabaseBrowser().from("readers").update(patch).eq("id", readerId);
  if (error) throw new Error(`Couldn't save settings: ${error.message}`);
}

export async function markWeeksPaid(readerId: string, weeks: string[], now: Date = new Date()): Promise<void> {
  if (!weeks.length) return;
  const rows = weeks.map((week_start) => ({ reader_id: readerId, week_start, earned: true, paid_at: now.toISOString() }));
  const { error } = await supabaseBrowser().from("reward_weeks").upsert(rows, { onConflict: "reader_id,week_start" });
  if (error) throw new Error(`Couldn't mark the week paid: ${error.message}`);
}

/** "Re-run reading check": forget the current baseline (history is kept in the baselines table). */
export async function clearBaseline(readerId: string): Promise<void> {
  const { error } = await supabaseBrowser().from("readers").update({ current_baseline_id: null }).eq("id", readerId);
  if (error) throw new Error(`Couldn't reset the reading check: ${error.message}`);
}

export async function recordTroubleWords(readerId: string, missed: string[], won: string[]): Promise<void> {
  if (!missed.length && !won.length) return;
  const { error } = await supabaseBrowser().rpc("record_trouble_words", { p_reader_id: readerId, p_missed: missed, p_won: won });
  if (error) throw new Error(`Couldn't save tricky words: ${error.message}`);
}

/** Delete all progress for the given readers and put their levels back to the start level. PINs and interests stay. */
export async function eraseProgress(readers: { id: string; startLevel: number }[]): Promise<void> {
  const sb = supabaseBrowser();
  const ids = readers.map((r) => r.id);
  if (!ids.length) return;
  for (const table of ["sessions", "trouble_words", "reward_weeks"]) {
    const { error } = await sb.from(table).delete().in("reader_id", ids);
    if (error) throw new Error(`Couldn't erase ${table.replace("_", " ")}: ${error.message}`);
  }
  // Baselines and AI passages reference readers/sessions; go last.
  for (const r of readers) {
    const { error } = await sb.from("readers").update({ current_baseline_id: null, level: r.startLevel }).eq("id", r.id);
    if (error) throw new Error(`Couldn't reset the level: ${error.message}`);
  }
  const { error: bErr } = await sb.from("baselines").delete().in("reader_id", ids);
  if (bErr) throw new Error(`Couldn't erase baselines: ${bErr.message}`);
  const { error: pErr } = await sb.from("passages").delete().in("reader_id", ids);
  if (pErr) throw new Error(`Couldn't erase stories: ${pErr.message}`);
}

/* ---------- API routes ---------- */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : `Request failed (${res.status}).`);
  return data as T;
}

export interface PinCheck {
  ok: boolean;
  message?: string;
}

/** Check a reader's PIN (target = reader id) or the parent PIN (target = "parent"). Rate-limited server-side. */
export async function verifyPin(target: string, pin: string): Promise<PinCheck> {
  try {
    const r = await postJson<{ ok: boolean; reason?: string }>("/api/verify-pin", { target, pin });
    if (r.ok) return { ok: true };
    if (r.reason === "not-set") return { ok: false, message: "No PIN is set yet. A grown-up can set one in the parent view." };
    return { ok: false, message: "That PIN doesn't match. Try again." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export interface PinsBody {
  parentPin?: string;
  readers?: { id: string; pin: string }[];
}

/** Set PINs. The server hashes them and checks the parent/reader PINs are all different. Throws with a message to show. */
export async function setPins(body: PinsBody): Promise<void> {
  await postJson<{ ok: true }>("/api/pins", body);
}

export async function saveSessionRemote(payload: SessionPayload): Promise<SaveSessionResult> {
  const r = await postJson<Omit<SaveSessionResult, "saved" | "baseline"> & { baseline: BaselineRow | null }>("/api/sessions", payload);
  return { ...r, saved: true, baseline: r.baseline ? rowToBaseline(r.baseline) : null };
}
