import { describe, expect, it } from "vitest";
import { allowAttempt } from "../rateLimit";

describe("allowAttempt (5 per minute)", () => {
  const t0 = 1_000_000;
  it("allows the first five tries in a minute and blocks the sixth", () => {
    const tries: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect(allowAttempt(tries, t0 + i * 1000).ok).toBe(true);
      tries.push(t0 + i * 1000);
    }
    const sixth = allowAttempt(tries, t0 + 5000);
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSec).toBe(55); // the oldest try ages out at t0 + 60s
  });
  it("lets the caller back in once the oldest try leaves the window", () => {
    const tries = [0, 1, 2, 3, 4].map((i) => t0 + i * 1000);
    expect(allowAttempt(tries, t0 + 59_999).ok).toBe(false);
    expect(allowAttempt(tries, t0 + 60_001).ok).toBe(true);
  });
  it("ignores tries outside the window and in the future", () => {
    expect(allowAttempt([t0 - 70_000, t0 - 61_000, t0 + 5000], t0).ok).toBe(true);
    expect(allowAttempt([], t0).ok).toBe(true);
  });
});
