/* Accuracy, WCPM, stars, leveling and reading-check routing. Pure functions; unit-tested. */

import { MAX_LEVEL, MIN_LEVEL } from "./passages";
import { cleanWord, type ReadWord, type WordStatus } from "./words";

export interface ReadResult {
  /** Words read correctly (including soft-skipped small words). */
  ok: number;
  /** Words attempted: everything up to the reading pointer, at least 1. */
  attempted: number;
  total: number;
  /** ok / attempted, 0..1. Skipped and helped words count as errors. */
  acc: number;
  /** Words correct per minute, or null if she read for less than 8 seconds. */
  wcpm: number | null;
  /** Unique missed words (skipped or helped), lowercase, longer than 2 letters. */
  missed: string[];
  helps: number;
  /** Every word the coach helped with, in order, lowercase (one entry per help, so duplicates are kept). */
  helped: string[];
  /** Fraction of the passage reached, 0..1. */
  finishedPct: number;
  /** When she read the first and last word (ms since epoch), or null if she never got going. */
  startedAt: number | null;
  endedAt: number | null;
}

/** Thresholds, in one place so they are easy to tune. */
export const RULES = {
  /** A session below this fraction of the story is not saved. */
  minFinishToSave: 0.5,
  /** A session must reach this fraction of the story to count toward the weekly goal. */
  minFinishToCount: 0.8,
  /** Reading check: pass a level at this accuracy and at least `checkMinRight` questions right. */
  checkPassAcc: 0.93,
  checkMinRight: 2,
  /** Reading check stops after this many stories. */
  checkMaxStories: 5,
  /** Practice leveling. */
  levelUpAcc: 0.97,
  levelDownAcc: 0.88,
  levelDownMaxRight: 1,
  /** Star for accuracy at or above this. */
  starAcc: 0.93,
  /** Stall help after this many ms without progress; first-word nudge after `firstWordNudgeMs`. */
  stallMs: 5500,
  firstWordNudgeMs: 10000,
  /** Minimum seconds of reading before WCPM is reported. */
  minSecondsForWcpm: 8,
} as const;

export function scoreReading(
  words: ReadWord[],
  status: WordStatus[],
  p: number,
  startT: number | null,
  endT: number | null,
  helps: number,
): ReadResult {
  const n = words.length;
  const attempted = Math.max(p, 1);
  let ok = 0;
  const missed: string[] = [];
  const helped: string[] = [];
  for (let i = 0; i < p; i++) {
    const s = status[i];
    const w = cleanWord(words[i].disp).toLowerCase();
    if (s === "ok" || s === "soft") ok++;
    else if (s === "skip" || s === "help") missed.push(w);
    if (s === "help") helped.push(w);
  }
  const secs = startT != null && endT != null ? (endT - startT) / 1000 : 0;
  const wcpm = secs >= RULES.minSecondsForWcpm ? Math.round(ok / (secs / 60)) : null;
  const uniqMissed = [...new Set(missed)].filter((w) => w.length > 2);
  return { ok, attempted, total: n, acc: ok / attempted, wcpm, missed: uniqMissed, helps, helped, finishedPct: n ? p / n : 0, startedAt: startT, endedAt: endT };
}

/** 1 for finishing, +1 for accuracy >= 93%, +1 for all questions right. */
export function starsFor(acc: number, compRight: number, compTotal: number): number {
  return 1 + (acc >= RULES.starAcc ? 1 : 0) + (compTotal > 0 && compRight === compTotal ? 1 : 0);
}

export function sessionCounts(finishedPct: number): boolean {
  return finishedPct >= RULES.minFinishToCount;
}

export function sessionSaves(finishedPct: number): boolean {
  return finishedPct >= RULES.minFinishToSave;
}

/** Level after a practice story. Up on 97%+ and all right; down below 88% or 1 or fewer right. */
export function nextLevelAfterPractice(level: number, acc: number, compRight: number, compTotal: number): number {
  if (acc >= RULES.levelUpAcc && compRight === compTotal) return Math.min(MAX_LEVEL, level + 1);
  if (acc < RULES.levelDownAcc || compRight <= RULES.levelDownMaxRight) return Math.max(MIN_LEVEL, level - 1);
  return level;
}

export function checkPassed(acc: number, compRight: number): boolean {
  return acc >= RULES.checkPassAcc && compRight >= RULES.checkMinRight;
}

export interface CheckState {
  /** Level -> passed? for every level tested so far. */
  tested: Record<number, boolean>;
  /** Stories completed so far in this check. */
  count: number;
  /** Passage ids read during the check. */
  ids: string[];
  /** Level currently being tested. */
  current: number;
}

/**
 * Where the reading check goes after a story at `current` with result `passed`.
 * Returns the next level to test, or null when the check is over.
 */
export function nextCheckLevel(tested: Record<number, boolean>, current: number, passed: boolean, count: number): number | null {
  if (count >= RULES.checkMaxStories) return null;
  if (passed && current < MAX_LEVEL && tested[current + 1] === undefined) return current + 1;
  if (!passed && current > MIN_LEVEL && tested[current - 1] === undefined) return current - 1;
  return null;
}

/** Final level after a check: the highest level passed, or 1 if none. */
export function checkFinalLevel(tested: Record<number, boolean>): number {
  const passed = Object.keys(tested).filter((k) => tested[+k]).map(Number);
  return passed.length ? Math.max(...passed) : MIN_LEVEL;
}
