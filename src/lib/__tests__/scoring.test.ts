import { describe, expect, it } from "vitest";
import { checkFinalLevel, checkPassed, nextCheckLevel, nextLevelAfterPractice, scoreReading, sessionCounts, sessionSaves, starsFor } from "../scoring";
import { toReadWords, type WordStatus } from "../words";

describe("scoreReading", () => {
  const words = toReadWords("The cat sat on the mat today and then it slept.");
  it("counts ok and soft as correct, skip and help as errors", () => {
    const status: WordStatus[] = ["soft", "ok", "ok", "skip", "soft", "ok", "help", "ok", "ok", "todo", "todo"];
    const r = scoreReading(words, status, 9, 0, 60000, 1);
    expect(r.attempted).toBe(9);
    expect(r.ok).toBe(7);
    expect(r.acc).toBeCloseTo(7 / 9);
    expect(r.wcpm).toBe(7);
    expect(r.missed).toEqual(["today"]); // "on" is 2 letters, filtered out
    expect(r.finishedPct).toBeCloseTo(9 / 11);
  });
  it("reports no wcpm under 8 seconds of reading", () => {
    const status: WordStatus[] = words.map(() => "ok");
    expect(scoreReading(words, status, words.length, 0, 5000, 0).wcpm).toBeNull();
  });
  it("treats zero attempted as one so accuracy is defined", () => {
    const r = scoreReading(words, words.map(() => "todo"), 0, null, null, 0);
    expect(r.attempted).toBe(1);
    expect(r.acc).toBe(0);
  });
});

describe("stars and counting", () => {
  it("awards 1 for finishing, +1 for 93% accuracy, +1 for all questions", () => {
    expect(starsFor(0.5, 1, 3)).toBe(1);
    expect(starsFor(0.93, 2, 3)).toBe(2);
    expect(starsFor(0.99, 3, 3)).toBe(3);
  });
  it("counts toward the goal at 80% read, saves at 50%", () => {
    expect(sessionCounts(0.79)).toBe(false);
    expect(sessionCounts(0.8)).toBe(true);
    expect(sessionSaves(0.49)).toBe(false);
    expect(sessionSaves(0.5)).toBe(true);
  });
});

describe("leveling after practice", () => {
  it("levels up at 97% and all right, capped at 7", () => {
    expect(nextLevelAfterPractice(3, 0.97, 3, 3)).toBe(4);
    expect(nextLevelAfterPractice(7, 1, 3, 3)).toBe(7);
  });
  it("levels down below 88% or with 1 or fewer right, floored at 1", () => {
    expect(nextLevelAfterPractice(3, 0.87, 3, 3)).toBe(2);
    expect(nextLevelAfterPractice(3, 0.95, 1, 3)).toBe(2);
    expect(nextLevelAfterPractice(1, 0.5, 0, 3)).toBe(1);
  });
  it("otherwise stays", () => {
    expect(nextLevelAfterPractice(3, 0.95, 2, 3)).toBe(3);
    expect(nextLevelAfterPractice(3, 0.97, 2, 3)).toBe(3);
  });
});

describe("reading check routing", () => {
  it("passes at 93% with 2 of 3", () => {
    expect(checkPassed(0.93, 2)).toBe(true);
    expect(checkPassed(0.929, 3)).toBe(false);
    expect(checkPassed(0.99, 1)).toBe(false);
  });
  it("goes up after a pass and down after a fail", () => {
    expect(nextCheckLevel({ 3: true }, 3, true, 1)).toBe(4);
    expect(nextCheckLevel({ 3: false }, 3, false, 1)).toBe(2);
  });
  it("stops when the next level was already tested", () => {
    expect(nextCheckLevel({ 3: true, 4: false }, 4, false, 2)).toBeNull();
    expect(nextCheckLevel({ 3: false, 2: true }, 2, true, 2)).toBeNull();
  });
  it("stops at the ends of the scale and after 5 stories", () => {
    expect(nextCheckLevel({ 7: true }, 7, true, 1)).toBeNull();
    expect(nextCheckLevel({ 1: false }, 1, false, 1)).toBeNull();
    expect(nextCheckLevel({ 3: true, 4: true, 5: true, 6: true, 7: true }, 7, true, 5)).toBeNull();
    expect(nextCheckLevel({ 3: true, 4: true, 5: true, 6: true }, 6, true, 5)).toBeNull();
  });
  it("final level is the highest passed, or 1", () => {
    expect(checkFinalLevel({ 3: true, 4: true, 5: false })).toBe(4);
    expect(checkFinalLevel({ 3: false, 2: false })).toBe(1);
  });
});
