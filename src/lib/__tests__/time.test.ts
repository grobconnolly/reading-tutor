import { describe, expect, it } from "vitest";
import { dayKey, shiftDayKey, streakFromDays, weekKey } from "../time";

describe("weekKey in America/Los_Angeles", () => {
  it("Sunday 23:59 Pacific belongs to the week that started the previous Monday", () => {
    // 2026-10-18 is a Sunday. 23:59 PDT = 06:59 UTC the next day.
    expect(weekKey(new Date("2026-10-19T06:59:00Z"))).toBe("2026-10-12");
  });
  it("Monday 00:00 Pacific starts a new week", () => {
    expect(weekKey(new Date("2026-10-19T07:00:00Z"))).toBe("2026-10-19");
  });
  it("uses Pacific, not UTC, for the day", () => {
    // 2026-10-19T03:00Z is still Sunday evening in Los Angeles.
    expect(dayKey(new Date("2026-10-19T03:00:00Z"))).toBe("2026-10-18");
  });
  it("handles the fall DST change (Nov 1, 2026)", () => {
    // Sunday Nov 1 2026 23:59 PST = 07:59 UTC Nov 2
    expect(weekKey(new Date("2026-11-02T07:59:00Z"))).toBe("2026-10-26");
    expect(weekKey(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });
  it("a Monday maps to itself", () => {
    expect(weekKey(new Date("2026-10-12T19:00:00Z"))).toBe("2026-10-12");
  });
});

describe("shiftDayKey and streak", () => {
  it("shifts across month boundaries", () => {
    expect(shiftDayKey("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("counts consecutive days ending today or yesterday", () => {
    const now = new Date("2026-10-19T19:00:00Z"); // Mon Oct 19, noon Pacific
    expect(streakFromDays(new Set(["2026-10-19", "2026-10-18", "2026-10-17"]), now)).toBe(3);
    expect(streakFromDays(new Set(["2026-10-18", "2026-10-17"]), now)).toBe(2);
    expect(streakFromDays(new Set(["2026-10-17"]), now)).toBe(0);
  });
});
