import { describe, expect, it } from "vitest";
import { advance, norm, toReadWords, tokenize, wordMatch, type AlignState } from "../words";

function state(text: string): AlignState {
  const words = toReadWords(text);
  return { words, status: words.map(() => "todo"), p: 0 };
}

describe("norm / tokenize", () => {
  it("lowercases and strips punctuation and apostrophes", () => {
    expect(norm("Don't!")).toBe("dont");
    expect(norm("“Tomorrow,”")).toBe("tomorrow");
  });
  it("splits on whitespace and dashes", () => {
    expect(tokenize("twelve-year-old Theo — ran")).toEqual(["twelve", "year", "old", "theo", "ran"]);
  });
});

describe("wordMatch", () => {
  it("matches exact and homophones", () => {
    expect(wordMatch("to", "two")).toBe(true);
    expect(wordMatch("their", "there")).toBe(true);
    expect(wordMatch("4", "four")).toBe(true);
  });
  it("tolerates one edit on words of 5+ letters and two on 8+", () => {
    expect(wordMatch("volcanos", "volcanoes")).toBe(true);
    expect(wordMatch("bilumunescence", "bioluminescence")).toBe(true);
    expect(wordMatch("cat", "cot")).toBe(false);
  });
  it("accepts plural / singular slips on 4+ letter words", () => {
    expect(wordMatch("goats", "goat")).toBe(true);
    expect(wordMatch("dogs", "dog")).toBe(false); // target too short for the plural rule
  });
});

describe("advance", () => {
  it("marks the matched word ok and moves the pointer", () => {
    const st = state("Max is a big dog.");
    expect(advance(st, "max")).toBe(true);
    expect(st.status[0]).toBe("ok");
    expect(st.p).toBe(1);
  });
  it("looks ahead up to 4 words, marking skipped content words as skip and small words as soft", () => {
    const st = state("Max is a big dog.");
    expect(advance(st, "dog")).toBe(true);
    expect(st.status).toEqual(["skip", "soft", "soft", "skip", "ok"]);
    expect(st.p).toBe(5);
  });
  it("does not match beyond the lookahead window", () => {
    const st = state("one two three four five six seven");
    expect(advance(st, "six")).toBe(false);
    expect(st.p).toBe(0);
  });
  it("never downgrades a word already marked helped", () => {
    const st = state("Max is a big dog.");
    st.status[0] = "help";
    st.p = 1;
    advance(st, "dog");
    expect(st.status[0]).toBe("help");
  });
});
