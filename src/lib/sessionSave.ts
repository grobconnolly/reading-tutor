/*
 * What POST /api/sessions does with a finished session, as pure functions so the route is thin and
 * the rules are unit-tested. The same planner runs in the browser as a fallback when the save fails.
 */

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

  return {
    ok: true,
    payload: {
      readerId, mode, passageId, startedAt, endedAt, wordsTotal, wordsAttempted, wordsCorrect, accuracy, wcpm,
      compRight, compTotal, helpedWords, missedWords, wonWords, finishedPct, check,
    },
  };
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
    counts_for_goal: counts,
    stars,
  };

  return {
    session, stars, counts, levelBefore: reader.level, level, baseline, weekStart, countedBefore, countedAfter, goalCrossed,
    rewardWeek: counts ? { week_start: weekStart, stories: countedAfter, earned: countedAfter >= reader.weeklyGoal } : null,
  };
}
