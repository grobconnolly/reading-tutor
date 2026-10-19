/* App state for milestone 1: everything lives in localStorage on the device. Milestone 2 moves it to Supabase. */

import { PASSAGES, type Passage } from "./passages";
import { dayKey, streakFromDays, weekKey } from "./time";

export interface TroubleEntry {
  miss: number;
  win: number;
}

export interface SessionRec {
  id: string;
  /** ISO timestamp. */
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
}

export interface Baseline {
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
  /** 4 digits, or null until set up. Convenience lock, not security. */
  pin: string | null;
  interests: string;
  /** Current reading level 1..7. */
  level: number;
  /** Level the reading check begins at. */
  startLevel: number;
  /** Stories per week for the reward. */
  goal: number;
  /** Weekly reward in dollars. */
  reward: number;
  baseline: Baseline | null;
  sessions: SessionRec[];
  trouble: Record<string, TroubleEntry>;
  /** weekKey -> ISO timestamp paid. */
  paidWeeks: Record<string, string>;
  stars: number;
  aiPassages: Passage[];
}

export interface AppState {
  version: 2;
  parentPin: string | null;
  readers: Reader[];
}

export const STORAGE_KEY = "reading-coach.v2";
export const PARENT_UNLOCK_KEY = "reading-coach.parent-unlocked";

function blankReader(id: string, name: string, grade: number, startLevel: number): Reader {
  return {
    id, name, grade, pin: null, interests: "", level: startLevel, startLevel, goal: 5, reward: 5,
    baseline: null, sessions: [], trouble: {}, paidWeeks: {}, stars: 0, aiPassages: [],
  };
}

/** Stella (grade 5, starts at level 3) and Penny (grade 3, starts at level 2). */
export function defaultState(): AppState {
  return {
    version: 2,
    parentPin: null,
    readers: [blankReader("stella", "Stella", 5, 3), blankReader("penny", "Penny", 3, 2)],
  };
}

export function loadState(): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const base = defaultState();
    const readers = (parsed.readers ?? []).map((r) => {
      const tmpl = base.readers.find((b) => b.id === r.id) ?? blankReader(r.id, r.name, r.grade, r.startLevel ?? 3);
      return { ...tmpl, ...r };
    });
    // Keep both girls present even if an older save only had one.
    for (const b of base.readers) if (!readers.some((r) => r.id === b.id)) readers.push(b);
    return { version: 2, parentPin: parsed.parentPin ?? null, readers };
  } catch {
    return defaultState();
  }
}

export function saveState(s: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the session still works, it just won't persist */
  }
}

export function clearState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(PARENT_UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

export function isSetupComplete(s: AppState): boolean {
  return !!s.parentPin && s.readers.every((r) => !!r.pin);
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

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
