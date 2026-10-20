import type { AzureDetail } from "@/lib/azureAlign";
/* Row shapes as the browser and route handlers read them from Supabase. Column lists match the grants in the migration. */

import type { Question } from "@/lib/passages";

export interface ProfileRow {
  id: string;
  parent_pin_set: boolean;
}

export interface ReaderRow {
  id: string;
  parent_id: string;
  name: string;
  pin_set: boolean;
  grade: number;
  interests: string;
  level: number;
  start_level: number;
  weekly_goal: number;
  weekly_reward_cents: number;
  reward_kind: "cash" | "prize";
  reward_label: string | null;
  current_baseline_id: string | null;
}

export interface PassageRow {
  id: string;
  level: number;
  title: string;
  text: string;
  questions: Question[];
  source: "library" | "ai";
  reader_id: string | null;
}

export interface SessionRow {
  id: string;
  reader_id: string;
  passage_id: string;
  mode: "check" | "practice";
  started_at: string;
  ended_at: string;
  /** 0..1. PostgREST may send numeric columns as strings. */
  accuracy: number | string;
  wcpm: number | null;
  comp_right: number;
  comp_total: number;
  helped_words: string[];
  missed_words: string[];
  /** What the listener heard, per word (milestone 3). Older rows have null. */
  azure_scores?: AzureDetail | null;
  counts_for_goal: boolean;
  stars: number;
}

export interface TroubleRow {
  reader_id: string;
  word: string;
  misses: number;
  wins: number;
}

export interface BaselineRow {
  id: string;
  reader_id: string;
  date: string;
  level: number;
  wcpm: number | null;
  passage_ids: string[];
}

export interface RewardWeekRow {
  reader_id: string;
  /** 'YYYY-MM-DD' Monday, America/Los_Angeles. */
  week_start: string;
  stories: number;
  earned: boolean;
  paid_at: string | null;
}

export interface AppRows {
  profile: ProfileRow | null;
  readers: ReaderRow[];
  /** AI passages only; the library comes from src/lib/passages.ts. */
  passages: PassageRow[];
  sessions: SessionRow[];
  trouble: TroubleRow[];
  baselines: BaselineRow[];
  rewardWeeks: RewardWeekRow[];
}

/** Columns the browser is allowed to read. Keep in step with the grants in the migration. */
export const READER_COLUMNS = "id, parent_id, name, pin_set, grade, interests, level, start_level, weekly_goal, weekly_reward_cents, reward_kind, reward_label, current_baseline_id";
export const SESSION_COLUMNS = "id, reader_id, passage_id, mode, started_at, ended_at, accuracy, wcpm, comp_right, comp_total, helped_words, missed_words, azure_scores, counts_for_goal, stars";
export const PASSAGE_COLUMNS = "id, level, title, text, questions, source, reader_id";
export const BASELINE_COLUMNS = "id, reader_id, date, level, wcpm, passage_ids";
export const REWARD_WEEK_COLUMNS = "reader_id, week_start, stories, earned, paid_at";
export const TROUBLE_COLUMNS = "reader_id, word, misses, wins";
