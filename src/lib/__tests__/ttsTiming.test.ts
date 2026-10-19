import { describe, expect, it } from "vitest";
import { estimateWordStarts, LEAD_SILENCE, mp3Duration, syllables, TAIL_SILENCE, wordWeight } from "@/lib/ttsTiming";

describe("syllables", () => {
  it("counts vowel groups and drops a silent e", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("make")).toBe(1);
    expect(syllables("little")).toBe(2);
    expect(syllables("banana")).toBe(3);
    expect(syllables("the")).toBe(1);
    expect(syllables("Stella!")).toBe(2);
  });
  it("never returns zero and counts digits", () => {
    expect(syllables("—")).toBe(1);
    expect(syllables("5")).toBe(1);
    expect(syllables("25")).toBe(2);
  });
});

describe("wordWeight", () => {
  it("adds a long pause after a sentence and a short one after a comma", () => {
    expect(wordWeight("dog.").pause).toBeGreaterThan(wordWeight("dog,").pause);
    expect(wordWeight("dog,").pause).toBeGreaterThan(0);
    expect(wordWeight("dog").pause).toBe(0);
    expect(wordWeight('go!"').pause).toBe(wordWeight("go!").pause);
  });
});

describe("estimateWordStarts", () => {
  const tokens = "The quick brown fox, named Max, jumped over the lazy dog. Then it slept.".split(" ");

  it("starts after the lead silence, climbs, and ends before the tail silence", () => {
    const d = 6;
    const s = estimateWordStarts(tokens, d);
    expect(s).toHaveLength(tokens.length);
    expect(s[0]).toBeCloseTo(LEAD_SILENCE, 3);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(s[s.length - 1]).toBeLessThan(d - TAIL_SILENCE);
  });

  it("scales the speech between the lead and tail silence with the clip length", () => {
    const a = estimateWordStarts(tokens, 6);
    const b = estimateWordStarts(tokens, 12);
    const silence = LEAD_SILENCE + TAIL_SILENCE;
    expect((b[5] - b[0]) / (a[5] - a[0])).toBeCloseTo((12 - silence) / (6 - silence), 2);
  });

  it("leaves a bigger gap after a period than between plain words", () => {
    const s = estimateWordStarts(tokens, 6);
    const i = tokens.indexOf("dog.");
    const afterPeriod = s[i + 1] - s[i];
    const plain = s[2] - s[1]; // "quick" -> "brown"
    expect(afterPeriod).toBeGreaterThan(plain);
  });

  it("handles empty input and tiny clips", () => {
    expect(estimateWordStarts([], 3)).toEqual([]);
    expect(estimateWordStarts(["hi"], 0.2)[0]).toBeLessThan(0.2);
    expect(estimateWordStarts(["hi"], 0)).toEqual([0]);
  });
});

/** One silent MPEG-2 Layer III frame: 24 kHz, 48 kbit/s, mono, no CRC. 144 bytes, 576 samples = 24 ms. */
function silentFrame(): Uint8Array {
  const f = new Uint8Array(144);
  f.set([0xff, 0xf3, 0x64, 0xc0]);
  return f;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe("mp3Duration", () => {
  it("sums frame lengths for a CBR file", () => {
    const n = 50;
    const bytes = concat(Array.from({ length: n }, silentFrame));
    expect(mp3Duration(bytes)).toBeCloseTo((n * 576) / 24000, 6);
  });
  it("skips an ID3v2 tag and stops at trailing junk", () => {
    const tag = new Uint8Array(10 + 20);
    tag.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20]);
    const junk = new Uint8Array([0x54, 0x41, 0x47, 1, 2, 3]);
    const bytes = concat([tag, silentFrame(), silentFrame(), junk]);
    expect(mp3Duration(bytes)).toBeCloseTo((2 * 576) / 24000, 6);
  });
  it("returns null when there are no frames", () => {
    expect(mp3Duration(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(mp3Duration(new Uint8Array(0))).toBeNull();
  });
});
