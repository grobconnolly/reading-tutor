import { describe, expect, it } from "vitest";
import { parseAzureDetail, parseSessionPayload, planSessionSave, type SessionPayload } from "../sessionSave";

const READER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function payload(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    readerId: READER, mode: "practice", passageId: "3a",
    startedAt: "2026-10-19T19:00:00Z", endedAt: "2026-10-19T19:02:00Z",
    wordsTotal: 100, wordsAttempted: 100, wordsCorrect: 95, accuracy: 0.95, wcpm: 80,
    compRight: 3, compTotal: 3, helpedWords: ["zoomed"], missedWords: ["zoomed"], wonWords: ["zoomed"], finishedPct: 1,
    ...over,
  };
}

describe("planSessionSave", () => {
  it("builds the session row, stars and counting from the payload", () => {
    const plan = planSessionSave(payload(), { level: 3, weeklyGoal: 5 }, []);
    expect(plan.session).toMatchObject({ reader_id: READER, passage_id: "3a", mode: "practice", accuracy: 0.95, wcpm: 80, counts_for_goal: true, stars: 3, missed_words: ["zoomed"], helped_words: ["zoomed"] });
    expect(plan.stars).toBe(3);
    expect(plan.counts).toBe(true);
    expect(plan.weekStart).toBe("2026-10-19");
    expect(plan.rewardWeek).toEqual({ week_start: "2026-10-19", stories: 1, earned: false });
  });

  it("levels up on 97%+ and all questions right, down below 88%, otherwise stays", () => {
    expect(planSessionSave(payload({ accuracy: 0.98, compRight: 3 }), { level: 3, weeklyGoal: 5 }, []).level).toBe(4);
    expect(planSessionSave(payload({ accuracy: 0.98, compRight: 3 }), { level: 7, weeklyGoal: 5 }, []).level).toBe(7);
    expect(planSessionSave(payload({ accuracy: 0.8, compRight: 3 }), { level: 3, weeklyGoal: 5 }, []).level).toBe(2);
    expect(planSessionSave(payload({ accuracy: 0.95, compRight: 1 }), { level: 1, weeklyGoal: 5 }, []).level).toBe(1);
    const same = planSessionSave(payload({ accuracy: 0.95, compRight: 2 }), { level: 3, weeklyGoal: 5 }, []);
    expect(same.level).toBe(3);
    expect(same.levelBefore).toBe(3);
    expect(same.baseline).toBeNull();
  });

  it("leaves the level alone mid-check and records level + baseline on the last check story", () => {
    const mid = planSessionSave(payload({ mode: "check", accuracy: 0.99, check: { tested: { 3: true }, ids: ["3a"], done: false } }), { level: 3, weeklyGoal: 5 }, []);
    expect(mid.level).toBe(3);
    expect(mid.baseline).toBeNull();
    const last = planSessionSave(payload({ mode: "check", accuracy: 0.9, wcpm: 77, compRight: 1, check: { tested: { 3: true, 4: true, 5: false }, ids: ["3a", "4a", "5a"], done: true } }), { level: 3, weeklyGoal: 5 }, []);
    expect(last.level).toBe(4);
    expect(last.baseline).toEqual({ level: 4, wcpm: 77, passage_ids: ["3a", "4a", "5a"] });
    const none = planSessionSave(payload({ mode: "check", check: { tested: { 2: false, 1: false }, ids: ["2a", "1a"], done: true } }), { level: 2, weeklyGoal: 5 }, []);
    expect(none.level).toBe(1);
  });

  it("counts only sessions in the same Pacific week and reports the goal crossing once", () => {
    // Sunday Oct 18 23:30 PDT = Monday 06:30Z; previous week. Monday 00:30 PDT = 07:30Z; this week.
    const earlier = ["2026-10-19T06:30:00Z", "2026-10-19T07:30:00Z", "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z", "2026-10-19T17:00:00Z"];
    const crossing = planSessionSave(payload(), { level: 3, weeklyGoal: 5 }, earlier);
    expect(crossing.countedBefore).toBe(4);
    expect(crossing.countedAfter).toBe(5);
    expect(crossing.goalCrossed).toBe(true);
    expect(crossing.rewardWeek).toEqual({ week_start: "2026-10-19", stories: 5, earned: true });
    const after = planSessionSave(payload(), { level: 3, weeklyGoal: 5 }, earlier.concat("2026-10-19T18:00:00Z"));
    expect(after.goalCrossed).toBe(false);
    expect(after.rewardWeek?.earned).toBe(true);
    // Sunday 23:59 PDT belongs to the week that started the previous Monday.
    const sunday = planSessionSave(payload({ endedAt: "2026-10-19T06:59:00Z" }), { level: 3, weeklyGoal: 5 }, earlier);
    expect(sunday.weekStart).toBe("2026-10-12");
    expect(sunday.countedBefore).toBe(1);
  });

  it("a short story (under 80%) saves but doesn't count or touch the reward week", () => {
    const plan = planSessionSave(payload({ finishedPct: 0.6, compRight: 2 }), { level: 3, weeklyGoal: 5 }, ["2026-10-19T15:00:00Z"]);
    expect(plan.counts).toBe(false);
    expect(plan.session.counts_for_goal).toBe(false);
    expect(plan.countedAfter).toBe(plan.countedBefore);
    expect(plan.rewardWeek).toBeNull();
    expect(plan.goalCrossed).toBe(false);
  });
});

describe("parseSessionPayload", () => {
  it("accepts a valid payload and rejects bad ones with a reason", () => {
    const ok = parseSessionPayload(payload());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.check).toBeUndefined();
    const bad = (over: Record<string, unknown>) => {
      const r = parseSessionPayload({ ...payload(), ...over });
      return r.ok ? "accepted" : r.error;
    };
    expect(bad({ readerId: "stella" })).toMatch(/uuid/);
    expect(bad({ mode: "quiz" })).toMatch(/mode/);
    expect(bad({ accuracy: 1.5 })).toMatch(/accuracy/);
    expect(bad({ wordsCorrect: 200 })).toMatch(/wordsCorrect/);
    expect(bad({ compRight: 4 })).toMatch(/compRight/);
    expect(bad({ endedAt: "yesterday" })).toMatch(/ISO/);
    expect(bad({ endedAt: "2026-10-19T18:00:00Z" })).toMatch(/before/);
    expect(bad({ wcpm: "fast" })).toMatch(/wcpm/);
    expect(bad({ missedWords: [1] })).toBe("accepted"); // non-string list falls back to empty
    expect(bad({ mode: "check" })).toMatch(/check outcome/);
    expect(bad({ mode: "check", check: { tested: { 9: true }, ids: [], done: true } })).toMatch(/levels 1-7/);
    expect(bad({ mode: "check", check: { tested: { 3: true }, ids: ["3a"], done: "yes" } })).toMatch(/done/);
    expect(parseSessionPayload(null).ok).toBe(false);
    expect(parseSessionPayload("x").ok).toBe(false);
  });
  it("keeps a valid check outcome", () => {
    const r = parseSessionPayload(payload({ mode: "check", check: { tested: { 3: true, 4: false }, ids: ["3a", "4b"], done: true } }));
    expect(r.ok && r.payload.check).toEqual({ tested: { 3: true, 4: false }, ids: ["3a", "4b"], done: true });
  });
});

describe("azure detail (milestone 3)", () => {
  const detail = { listener: "azure", scores: { accuracy: 88, fluency: 95, completeness: 93 }, inserted: ["big", "head"], words: [{ w: "Carlos", s: "miss", a: 6 }, { w: "was", s: "ok", a: 97 }, { w: "the", s: "soft", a: null }] };
  it("accepts the reading screen's record and saves it as azure_scores", () => {
    const parsed = parseSessionPayload({ ...payload(), azure: detail });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.azure).toEqual(detail);
    expect(planSessionSave(parsed.payload, { level: 3, weeklyGoal: 5 }, []).session.azure_scores).toEqual(detail);
  });
  it("saves null when the browser listened and sent nothing", () => {
    const parsed = parseSessionPayload(payload());
    expect(parsed.ok && parsed.payload.azure).toBeNull();
    expect(planSessionSave(payload(), { level: 3, weeklyGoal: 5 }, []).session.azure_scores).toBeNull();
  });
  it("keeps word times when present and rejects nonsense ones", () => {
    const timed = { ...detail, words: [{ w: "Carlos", s: "miss", a: 6, t: 2.004, d: 0.7 }] };
    expect(parseAzureDetail(timed)?.words[0]).toEqual({ w: "Carlos", s: "miss", a: 6, t: 2, d: 0.7 });
    expect(parseAzureDetail({ ...detail, words: [{ w: "Carlos", s: "miss", a: 6, t: -1, d: 0.7 }] })).toBeNull();
    expect(parseAzureDetail({ ...detail, words: [{ w: "Carlos", s: "miss", a: 6, t: 2 }] })).toBeNull();
  });
  it("rejects a malformed record", () => {
    expect(parseAzureDetail({ ...detail, listener: "cloud" })).toBeNull();
    expect(parseAzureDetail({ ...detail, scores: { accuracy: 101, fluency: 1, completeness: 1 } })).toBeNull();
    expect(parseAzureDetail({ ...detail, words: [{ w: "x", s: "nope", a: 1 }] })).toBeNull();
    expect(parseAzureDetail({ ...detail, inserted: [42] })).toBeNull();
    expect(parseSessionPayload({ ...payload(), azure: { listener: "azure" } }).ok).toBe(false);
  });
});
