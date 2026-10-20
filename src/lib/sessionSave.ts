/*
 * What POST /api/sessions does with a finished session, as pure functions so the route is thin and
 * the rules are unit-tested. The same planner runs in the browser as a fallback when the save fails.
 */

import type { AzureDetail } from "./azureAlign";
import { checkFinalLevel, nextLevelAfterPractice, sessionCounts, starsFor } from "./scoring";
import type { Baseline } from "./store";
import { weekKey } from "./time";

export interface CheckOutcome {
  /** Level -> passed?, for every level tested so far (including this story). */
  tested: Record<number, boolean>;
  /** Passage ids read during the check, in order. */
  ids: string[];
  /** True on the last story of the check: the level and baseline get recorded. */
  done: boolean;
}

export interface SessionPayload {
  readerId: string;
  mode: "check" | "practice";
  passageId: string;
  /** ISO timestamps. */
  startedAt: string;
  endedAt: string;
  wordsTotal: number;
  wordsAttempted: number;
  wordsCorrect: number;
  /** 0..1 */
  accuracy: number;
  wcpm: number | null;
  compRight: number;
  compTotal: number;
  helpedWords: string[];
  /** misses++ for each. */
  missedWords: string[];
  /** wins++ for each (passed in word practice during this session). */
  wonWords: string[];
  /** 0..1 */
  finishedPct: number;
  check?: CheckOutcome;
  /** What the listener heard, per word (milestone 3); saved as sessions.azure_scores. */
  azure?: AzureDetail | null;
}

export interface SessionInsert {
  reader_id: string;
  passage_id: string;
  mode: "check" | "practice";
  started_at: string;
  ended_at: string;
  words_total: number;
  words_attempted: number;
  words_correct: number;
  accuracy: number;
  wcpm: number | null;
  comp_right: number;
  comp_total: number;
  helped_words: string[];
  missed_words: string[];
  azure_scores: AzureDetail | null;
  counts_for_goal: boolean;
  stars: number;
}

export interface SavePlan {
  session: SessionInsert;
  stars: number;
  counts: boolean;
  levelBefore: number;
  level: number;
  /** Set on the last story of a reading check. */
  baseline: { level: number; wcpm: number | null; passage_ids: string[] } | null;
  weekStart: string;
  countedBefore: number;
  countedAfter: number;
  goalCrossed: boolean;
  /** Upsert this when the session counts. */
  rewardWeek: { week_start: string; stories: number; earned: boolean } | null;
}

/** What the route returns, and what the hook applies to local state. */
export interface SaveSessionResult {
  saved: boolean;
  sessionId: string;
  endedAt: string;
  stars: number;
  counts: boolean;
  levelBefore: number;
  level: number;
  countedBefore: number;
  countedAfter: number;
  goalCrossed: boolean;
  baseline: Baseline | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

type Parsed = { ok: true; payload: SessionPayload } | { ok: false; error: string };

/** Validate an untrusted request body. */
export function parseSessionPayload(body: unknown): Parsed {
  const bad = (error: string): Parsed => ({ ok: false, error });
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
  const num = (k: string) => (typeof b[k] === "number" && Number.isFinite(b[k] as number) ? (b[k] as number) : null);
  const int = (k: string) => { const v = num(k); return v != null && Number.isInteger(v) && v >= 0 ? v : null; };
  const strs = (k: string) => (Array.isArray(b[k]) && (b[k] as unknown[]).every((x) => typeof x === "string") ? (b[k] as string[]) : null);
  const iso = (k: string) => { const v = str(k); return v && !Number.isNaN(Date.parse(v)) ? v : null; };
  const unit = (k: string) => { const v = num(k); return v != null && v >= 0 && v <= 1 ? v : null; };

  const readerId = str("readerId");
  if (!isUuid(readerId)) return bad("readerId must be a uuid.");
  const mode = str("mode");
  if (mode !== "check" && mode !== "practice") return bad("mode must be 'check' or 'practice'.");
  const passageId = str("passageId");
  if (!passageId || passageId.length > 80) return bad("passageId is required.");
  const startedAt = iso("startedAt"), endedAt = iso("endedAt");
  if (!startedAt || !endedAt) return bad("startedAt and endedAt must be ISO timestamps.");
  if (Date.parse(endedAt) < Date.parse(startedAt)) return bad("endedAt is before startedAt.");
  const wordsTotal = int("wordsTotal"), wordsAttempted = int("wordsAttempted"), wordsCorrect = int("wordsCorrect");
  if (wordsTotal == null || wordsAttempted == null || wordsCorrect == null) return bad("wordsTotal, wordsAttempted and wordsCorrect must be whole numbers.");
  if (wordsCorrect > Math.max(wordsAttempted, 1)) return bad("wordsCorrect cannot exceed wordsAttempted.");
  const accuracy = unit("accuracy"), finishedPct = unit("finishedPct");
  if (accuracy == null || finishedPct == null) return bad("accuracy and finishedPct must be between 0 and 1.");
  const wcpmRaw = b["wcpm"];
  const wcpm = wcpmRaw == null ? null : int("wcpm");
  if (wcpmRaw != null && wcpm == null) return bad("wcpm must be a whole number or null.");
  const compRight = int("compRight"), compTotal = int("compTotal");
  if (compRight == null || compTotal == null || compRight > compTotal || compTotal > 10) return bad("compRight and compTotal must be whole numbers with compRight <= compTotal.");
  const helpedWords = strs("helpedWords") ?? [], missedWords = strs("missedWords") ?? [], wonWords = strs("wonWords") ?? [];
  if (helpedWords.length > 500 || missedWords.length > 500 || wonWords.length > 500) return bad("Too many words.");

  let check: CheckOutcome | undefined;
  if (b["check"] != null) {
    const c = b["check"];
    if (!c || typeof c !== "object" || Array.isArray(c)) return bad("check must be an object.");
    const cc = c as Record<string, unknown>;
    const tested: Record<number, boolean> = {};
    if (!cc.tested || typeof cc.tested !== "object" || Array.isArray(cc.tested)) return bad("check.tested must be an object.");
    for (const [k, v] of Object.entries(cc.tested as Record<string, unknown>)) {
      const lvl = Number(k);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 7 || typeof v !== "boolean") return bad("check.tested must map levels 1-7 to booleans.");
      tested[lvl] = v;
    }
    const ids = Array.isArray(cc.ids) && (cc.ids as unknown[]).every((x) => typeof x === "string") ? (cc.ids as string[]) : null;
    if (!ids) return bad("check.ids must be a list of passage ids.");
    if (typeof cc.done !== "boolean") return bad("check.done must be a boolean.");
    check = { tested, ids, done: cc.done };
  }
  if (mode === "check" && !check) return bad("A check session needs a check outcome.");

  let azure: AzureDetail | null = null;
  if (b["azure"] != null) {
    const a = parseAzureDetail(b["azure"]);
    if (!a) return bad("azure must describe the listener, scores, inserted words and words.");
    azure = a;
  }

  return {
    ok: true,
    payload: {
      readerId, mode, passageId, startedAt, endedAt, wordsTotal, wordsAttempted, wordsCorrect, accuracy, wcpm,
      compRight, compTotal, helpedWords, missedWords, wonWords, finishedPct, check, azure,
    },
  };
}

const LISTENERS = new Set(["azure", "browser", "mixed"]);
const STATUSES = new Set(["todo", "ok", "soft", "skip", "help", "miss"]);
const score = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null;
const secs = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 36000 ? Math.round(v * 100) / 100 : null;

/** Validate the per-word record from the browser; null when it is not what the reading screen sends. */
export function parseAzureDetail(v: unknown): AzureDetail | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.listener !== "string" || !LISTENERS.has(d.listener)) return null;
  let scores: AzureDetail["scores"] = null;
  if (d.scores != null) {
    const s = d.scores as Record<string, unknown>;
    const accuracy = score(s.accuracy), fluency = score(s.fluency), completeness = score(s.completeness);
    if (accuracy == null || fluency == null || completeness == null) return null;
    scores = { accuracy, fluency, completeness };
  }
  if (!Array.isArray(d.inserted) || d.inserted.length > 500 || !d.inserted.every((x) => typeof x === "string" && x.length <= 40)) return null;
  if (!Array.isArray(d.words) || d.words.length > 2000) return null;
  const words: AzureDetail["words"] = [];
  for (const x of d.words) {
    if (!x || typeof x !== "object") return null;
    const w = x as Record<string, unknown>;
    if (typeof w.w !== "string" || w.w.length > 40 || typeof w.s !== "string" || !STATUSES.has(w.s)) return null;
    const a = w.a == null ? null : score(w.a);
    if (w.a != null && a == null) return null;
    const out: AzureDetail["words"][number] = { w: w.w, s: w.s as AzureDetail["words"][number]["s"], a };
    if (w.t != null || w.d != null) {
      const t = secs(w.t), d = secs(w.d);
      if (t == null || d == null) return null;
      out.t = t;
      out.d = d;
    }
    words.push(out);
  }
  return { listener: d.listener as AzureDetail["listener"], scores, inserted: d.inserted as string[], words };
}

/**
 * Decide everything the save changes. `countedEndedAt` are the ended_at timestamps of the reader's
 * sessions that already count toward the goal (any week; only this session's week is used).
 */
export function planSessionSave(p: SessionPayload, reader: { level: number; weeklyGoal: number }, countedEndedAt: string[]): SavePlan {
  const stars = starsFor(p.accuracy, p.compRight, p.compTotal);
  const counts = sessionCounts(p.finishedPct);
  const weekStart = weekKey(new Date(p.endedAt));
  const countedBefore = countedEndedAt.filter((t) => weekKey(new Date(t)) === weekStart).length;
  const countedAfter = countedBefore + (counts ? 1 : 0);
  const goalCrossed = countedBefore < reader.weeklyGoal && countedAfter >= reader.weeklyGoal;

  let level = reader.level;
  let baseline: SavePlan["baseline"] = null;
  if (p.mode === "practice") {
    level = nextLevelAfterPractice(reader.level, p.accuracy, p.compRight, p.compTotal);
  } else if (p.check?.done) {
    level = checkFinalLevel(p.check.tested);
    baseline = { level, wcpm: p.wcpm, passage_ids: p.check.ids };
  }

  const session: SessionInsert = {
    reader_id: p.readerId,
    passage_id: p.passageId,
    mode: p.mode,
    started_at: p.startedAt,
    ended_at: p.endedAt,
    words_total: p.wordsTotal,
    words_attempted: p.wordsAttempted,
    words_correct: p.wordsCorrect,
    accuracy: Math.round(p.accuracy * 10000) / 10000,
    wcpm: p.wcpm,
    comp_right: p.compRight,
    comp_total: p.compTotal,
    helped_words: p.helpedWords,
    missed_words: p.missedWords,
    azure_scores: p.azure ?? null,
    counts_for_goal: counts,
    stars,
  };

  return {
    session, stars, counts, levelBefore: reader.level, level, baseline, weekStart, countedBefore, countedAfter, goalCrossed,
    rewardWeek: counts ? { week_start: weekStart, stories: countedAfter, earned: countedAfter >= reader.weeklyGoal } : null,
  };
}
