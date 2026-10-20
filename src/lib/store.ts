/* The client's view of each reader, built from Supabase rows (see lib/db/mapping.ts), plus the derived values the screens use. */

import type { AzureDetail } from "@/lib/azureAlign";
import { PASSAGES, type Passage } from "./passages";
import type { RewardKind } from "./reward";
import { dayKey, streakFromDays, weekKey } from "./time";

export interface TroubleEntry {
  miss: number;
  win: number;
}

export interface SessionRec {
  id: string;
  /** ISO timestamp of when the reading ended. */
  date: string;
  mode: "check" | "practice";
  passageId: string;
  title: string;
  level: number;
  wcpm: number | null;
  /** Percent, 0..100. */
  acc: number;
  comp: number;
  compTotal: number;
  missed: string[];
  helps: number;
  /** Counts toward the weekly goal. */
  counts: boolean;
  stars: number;
  /** What the listener heard, per word (milestone 3); null for older sessions. */
  azure?: AzureDetail | null;
}

export interface Baseline {
  id: string;
  date: string;
  level: number;
  wcpm: number | null;
  ids: string[];
}

export interface Reader {
  id: string;
  name: string;
  /** School grade. Never shown to the reader. */
  grade: number;
  /** Whether her 4-digit PIN is set. The PIN is hashed in the database and checked server-side; it never reaches the browser. */
  pinSet: boolean;
  interests: string;
  /** Current reading level 1..7. */
  level: number;
  /** Level the reading check begins at. */
  startLevel: number;
  /** Stories per week for the reward. */
  goal: number;
  /** Weekly reward in dollars (when rewardKind is "cash"). */
  reward: number;
  /** The parent's choice: cash, or a prize described by rewardLabel. */
  rewardKind: RewardKind;
  /** What the prize is, e.g. "a trip to the bookstore". Empty until the parent fills it in. */
  rewardLabel: string;
  baseline: Baseline | null;
  /** Oldest first. */
  sessions: SessionRec[];
  trouble: Record<string, TroubleEntry>;
  /** weekKey -> ISO timestamp paid. */
  paidWeeks: Record<string, string>;
  /** Sum of stars over all sessions. */
  stars: number;
  aiPassages: Passage[];
}

export interface AppState {
  parentPinSet: boolean;
  readers: Reader[];
}

/** sessionStorage flag: the parent PIN was entered in this tab. */
export const PARENT_UNLOCK_KEY = "reading-coach.parent-unlocked";

export function isSetupComplete(s: AppState): boolean {
  return s.parentPinSet && s.readers.length > 0 && s.readers.every((r) => r.pinSet);
}

export function isValidPin(v: string): boolean {
  return /^\d{4}$/.test(v);
}

/* ---------- per-reader derived values ---------- */

export function countedInWeek(r: Reader, wk: string): number {
  return r.sessions.filter((s) => s.counts && weekKey(new Date(s.date)) === wk).length;
}

export function countedThisWeek(r: Reader, now: Date = new Date()): number {
  return countedInWeek(r, weekKey(now));
}

export function streak(r: Reader, now: Date = new Date()): number {
  return streakFromDays(new Set(r.sessions.map((s) => dayKey(new Date(s.date)))), now);
}

/** Past (and current) weeks where the goal was met and the reward has not been marked paid, oldest first. */
export function owedWeeks(r: Reader): string[] {
  const byWeek: Record<string, number> = {};
  for (const s of r.sessions) if (s.counts) {
    const k = weekKey(new Date(s.date));
    byWeek[k] = (byWeek[k] || 0) + 1;
  }
  return Object.keys(byWeek).filter((k) => byWeek[k] >= r.goal && !r.paidWeeks[k]).sort();
}

/** Weeks already marked paid, newest first. */
export function paidWeekList(r: Reader): { week: string; paidAt: string }[] {
  return Object.entries(r.paidWeeks).map(([week, paidAt]) => ({ week, paidAt })).sort((a, b) => (a.week < b.week ? 1 : -1));
}

export function lastWcpm(r: Reader): number | null {
  for (let i = r.sessions.length - 1; i >= 0; i--) {
    const w = r.sessions[i].wcpm;
    if (w != null) return w;
  }
  return null;
}

export function avgAccLast5(r: Reader): number | null {
  const last = r.sessions.slice(-5);
  if (!last.length) return null;
  return Math.round(last.reduce((a, s) => a + s.acc, 0) / last.length);
}

/** Words with more misses than wins, hardest first. */
export function trickyWords(r: Reader, limit = 8): { word: string; miss: number; win: number }[] {
  return Object.entries(r.trouble)
    .filter(([, t]) => t.miss > t.win)
    .map(([word, t]) => ({ word, miss: t.miss, win: t.win }))
    .sort((a, b) => (b.miss - b.win) - (a.miss - a.win) || b.miss - a.miss)
    .slice(0, limit);
}

/** Least-read passage at the reader's level, with how many times she has read it. */
export function pickPassage(r: Reader, level: number = r.level): { p: Passage; timesRead: number } {
  const pool = PASSAGES.concat(r.aiPassages).filter((p) => p.level === level);
  const counts: Record<string, number> = {};
  for (const s of r.sessions) counts[s.passageId] = (counts[s.passageId] || 0) + 1;
  const sorted = pool.slice().sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || Math.random() - 0.5);
  const p = sorted[0];
  return { p, timesRead: counts[p.id] || 0 };
}
