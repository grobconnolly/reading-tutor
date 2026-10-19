/* Pure: Supabase rows -> the AppState the screens render. Unit-tested. */

import { PASSAGES, type Passage } from "@/lib/passages";
import type { AppState, Baseline, Reader, SessionRec } from "@/lib/store";
import type { AppRows, BaselineRow, PassageRow, SessionRow } from "./types";

export function rowToPassage(r: PassageRow): Passage {
  return { id: r.id, level: r.level, title: r.title, text: r.text, questions: r.questions, source: r.source };
}

export function rowToBaseline(b: BaselineRow): Baseline {
  return { id: b.id, date: b.date, level: b.level, wcpm: b.wcpm, ids: b.passage_ids ?? [] };
}

export function rowToSession(s: SessionRow, passages: Map<string, Passage>): SessionRec {
  const p = passages.get(s.passage_id);
  return {
    id: s.id,
    date: s.ended_at,
    mode: s.mode,
    passageId: s.passage_id,
    title: p?.title ?? s.passage_id,
    level: p?.level ?? 0,
    wcpm: s.wcpm,
    acc: Math.round(Number(s.accuracy) * 100),
    comp: s.comp_right,
    compTotal: s.comp_total,
    missed: s.missed_words ?? [],
    helps: (s.helped_words ?? []).length,
    counts: s.counts_for_goal,
    stars: s.stars,
  };
}

export function buildAppState(rows: AppRows): AppState {
  const ai = rows.passages.map(rowToPassage);
  const byId = new Map<string, Passage>(PASSAGES.concat(ai).map((p) => [p.id, p]));
  const readers: Reader[] = rows.readers.map((r) => {
    const sessions = rows.sessions
      .filter((s) => s.reader_id === r.id)
      .slice()
      .sort((a, b) => (a.ended_at < b.ended_at ? -1 : a.ended_at > b.ended_at ? 1 : 0))
      .map((s) => rowToSession(s, byId));
    const trouble: Reader["trouble"] = {};
    for (const t of rows.trouble) if (t.reader_id === r.id) trouble[t.word] = { miss: t.misses, win: t.wins };
    const paidWeeks: Reader["paidWeeks"] = {};
    for (const w of rows.rewardWeeks) if (w.reader_id === r.id && w.paid_at) paidWeeks[w.week_start] = w.paid_at;
    const base = r.current_baseline_id ? rows.baselines.find((b) => b.id === r.current_baseline_id) : undefined;
    return {
      id: r.id,
      name: r.name,
      grade: r.grade,
      pinSet: r.pin_set,
      interests: r.interests ?? "",
      level: r.level,
      startLevel: r.start_level,
      goal: r.weekly_goal,
      reward: r.weekly_reward_cents / 100,
      rewardKind: r.reward_kind === "cash" ? "cash" : "prize",
      rewardLabel: r.reward_label ?? "",
      baseline: base ? rowToBaseline(base) : null,
      sessions,
      trouble,
      paidWeeks,
      stars: sessions.reduce((a, s) => a + s.stars, 0),
      aiPassages: rows.passages.filter((p) => p.reader_id === r.id).map(rowToPassage),
    };
  });
  return { parentPinSet: rows.profile?.parent_pin_set ?? false, readers };
}
