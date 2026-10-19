import { describe, expect, it } from "vitest";
import { buildAppState } from "../db/mapping";
import type { AppRows } from "../db/types";

const S = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

function rows(): AppRows {
  return {
    profile: { id: "p", parent_pin_set: true },
    readers: [
      { id: S, parent_id: "p", name: "Stella", pin_set: true, grade: 5, interests: "dogs", level: 4, start_level: 3, weekly_goal: 5, weekly_reward_cents: 500, reward_kind: "cash", reward_label: null, current_baseline_id: "b1" },
      { id: P, parent_id: "p", name: "Penny", pin_set: false, grade: 3, interests: "", level: 2, start_level: 2, weekly_goal: 3, weekly_reward_cents: 250, reward_kind: "prize", reward_label: "a trip to the bookstore", current_baseline_id: null },
    ],
    passages: [{ id: "ai-1", level: 4, title: "Dog Days", text: "Dogs.", questions: [], source: "ai", reader_id: S }],
    sessions: [
      { id: "s2", reader_id: S, passage_id: "ai-1", mode: "practice", started_at: "2026-10-19T19:00:00Z", ended_at: "2026-10-19T19:02:00Z", accuracy: "0.9700", wcpm: 90, comp_right: 3, comp_total: 3, helped_words: ["a", "b"], missed_words: ["b"], counts_for_goal: true, stars: 3 },
      { id: "s1", reader_id: S, passage_id: "3a", mode: "check", started_at: "2026-10-18T19:00:00Z", ended_at: "2026-10-18T19:02:00Z", accuracy: 0.9, wcpm: null, comp_right: 2, comp_total: 3, helped_words: [], missed_words: [], counts_for_goal: false, stars: 1 },
    ],
    trouble: [{ reader_id: S, word: "zoomed", misses: 2, wins: 1 }, { reader_id: P, word: "shoot", misses: 1, wins: 0 }],
    baselines: [{ id: "b0", reader_id: S, date: "2026-09-01T00:00:00Z", level: 3, wcpm: 60, passage_ids: ["3a"] }, { id: "b1", reader_id: S, date: "2026-10-18T19:02:00Z", level: 4, wcpm: 77, passage_ids: ["3a", "4a"] }],
    rewardWeeks: [{ reader_id: S, week_start: "2026-10-12", stories: 5, earned: true, paid_at: "2026-10-19T00:00:00Z" }, { reader_id: S, week_start: "2026-10-19", stories: 1, earned: false, paid_at: null }],
  };
}

describe("buildAppState", () => {
  it("maps readers, keeps each girl's data separate, and derives stars and the current baseline", () => {
    const s = buildAppState(rows());
    expect(s.parentPinSet).toBe(true);
    expect(s.readers.map((r) => r.name)).toEqual(["Stella", "Penny"]);
    const [stella, penny] = s.readers;
    expect(stella).toMatchObject({ pinSet: true, grade: 5, level: 4, startLevel: 3, goal: 5, reward: 5, rewardKind: "cash", rewardLabel: "", interests: "dogs", stars: 4 });
    expect(stella.baseline).toEqual({ id: "b1", date: "2026-10-18T19:02:00Z", level: 4, wcpm: 77, ids: ["3a", "4a"] });
    expect(stella.sessions.map((x) => x.id)).toEqual(["s1", "s2"]); // oldest first
    expect(stella.sessions[1]).toMatchObject({ title: "Dog Days", level: 4, acc: 97, helps: 2, missed: ["b"], counts: true, stars: 3, date: "2026-10-19T19:02:00Z" });
    expect(stella.sessions[0]).toMatchObject({ title: "The Rookie", level: 3, acc: 90, wcpm: null, mode: "check" });
    expect(stella.trouble).toEqual({ zoomed: { miss: 2, win: 1 } });
    expect(stella.paidWeeks).toEqual({ "2026-10-12": "2026-10-19T00:00:00Z" });
    expect(stella.aiPassages.map((p) => p.id)).toEqual(["ai-1"]);
    expect(penny).toMatchObject({ pinSet: false, reward: 2.5, goal: 3, rewardKind: "prize", rewardLabel: "a trip to the bookstore", stars: 0, baseline: null, sessions: [], aiPassages: [], paidWeeks: {} });
    expect(penny.trouble).toEqual({ shoot: { miss: 1, win: 0 } });
  });
  it("handles a brand-new account with no profile row yet", () => {
    const s = buildAppState({ ...rows(), profile: null, sessions: [], trouble: [], baselines: [], rewardWeeks: [], passages: [] });
    expect(s.parentPinSet).toBe(false);
    expect(s.readers[0].baseline).toBeNull();
  });
});
