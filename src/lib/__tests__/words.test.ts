import { describe, expect, it } from "vitest";
import { advance, advanceTokens, norm, toReadWords, tokenize, transcriptHasWord, wordMatch, type AlignState } from "../words";

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
  it("tolerates recognizer padding on names, scaled by the longer word", () => {
    expect(wordMatch("carlowes", "carlos")).toBe(true);
    expect(wordMatch("carlas", "carlos")).toBe(true);
    expect(wordMatch("carl", "carlos")).toBe(false);
    expect(wordMatch("the", "there")).toBe(false);
    expect(wordMatch("cat", "catch")).toBe(false);
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

describe("advanceTokens", () => {
  it("joins split tokens so a name read correctly is not marked skipped", () => {
    const st = state("Carlos was the youngest player.");
    expect(advanceTokens(st, tokenize("car los was the youngest player"))).toBe(5);
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });
  it("joins three tokens for a long word", () => {
    const st = state("Carlos was tired.");
    advanceTokens(st, tokenize("car lo s was tired"));
    expect(st.status[0]).toBe("ok");
    expect(st.p).toBe(3);
  });
  it("accepts one heard token for two glued story words", () => {
    const st = state("His base ball team won.");
    advanceTokens(st, tokenize("his baseball team won"));
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });
  it("still skips words that were really skipped", () => {
    const st = state("Carlos was the youngest player.");
    advanceTokens(st, tokenize("carlos was the player"));
    expect(st.status).toEqual(["ok", "ok", "ok", "skip", "ok"]);
  });
});

describe("transcriptHasWord", () => {
  it("finds a split name in a practice transcript", () => {
    expect(transcriptHasWord("car los", "carlos")).toBe(true);
    expect(transcriptHasWord("the word is carlos", "carlos")).toBe(true);
    expect(transcriptHasWord("carl", "carlos")).toBe(false);
  });
});
