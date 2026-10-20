import { describe, expect, it } from "vitest";
import type { AzureDetail } from "../azureAlign";
import { alignPlain, finalStatus, plainSame, reviewResult, type PlainWord } from "../review";
import type { ReadResult } from "../scoring";
import { toReadWords, type WordStatus } from "../words";

/** A finished read: every story word reached, with the live statuses and scores given. */
function read(story: string, live: [WordStatus, number | null][], extra: Partial<ReadResult> = {}): ReadResult {
  const words = toReadWords(story);
  const detail: AzureDetail = { listener: "azure", scores: { accuracy: 90, fluency: 90, completeness: 95 }, inserted: [], words: words.map((w, i) => ({ w: w.disp, s: live[i][0], a: live[i][1] })) };
  const ok = live.filter(([s]) => s === "ok" || s === "soft").length;
  return {
    ok, attempted: words.length, total: words.length, acc: ok / words.length, wcpm: 60, missed: [], helps: 0, finishedPct: 1,
    startedAt: 0, endedAt: 60000, helped: [], azure: detail.scores!, listener: "azure", insertions: 0, azureDetail: detail, ...extra,
  };
}
const plain = (text: string): PlainWord[] => text.split(/\s+/).filter(Boolean).map((w, i) => ({ w, t: i, d: 0.4 }));
const statuses = (r: ReadResult) => r.azureDetail!.words.map((w) => w.s);

describe("plainSame", () => {
  it("is exact apart from numbers, homophones and a one-letter slip on long words", () => {
    expect(plainSame("mouldiest", "moldiest")).toBe(true);
    expect(plainSame("3", "three")).toBe(true);
    expect(plainSame("fluffy", "fuzzy")).toBe(false);
    expect(plainSame("cabin", "cabinet")).toBe(false);
    expect(plainSame("jade", "jada")).toBe(false);
    expect(plainSame("tide", "tied")).toBe(false);
  });
});

describe("alignPlain", () => {
  it("matches in order, pairs a replaced word as said, and keeps the extras", () => {
    const story = toReadWords("Nina noticed that the bread had fuzzy green spots.").map((w) => w.norm);
    const { verdicts, extras } = alignPlain(story, plain("neither noticed that the bread add fluffy green spots um").map((w) => w.w));
    expect(verdicts.map((v) => v.kind)).toEqual(["said", "same", "same", "same", "same", "said", "said", "same", "same"]);
    expect(verdicts[0]).toEqual({ kind: "said", heard: "neither" });
    expect(verdicts[6]).toEqual({ kind: "said", heard: "fluffy" });
    expect(extras).toEqual(["um"]);
  });
  it("marks words it did not hear as missing", () => {
    const { verdicts } = alignPlain(["the", "goats", "were", "nervous"], ["the", "nervous"]);
    expect(verdicts.map((v) => v.kind)).toEqual(["same", "missing", "missing", "same"]);
  });
});

describe("finalStatus (Stella's cases)", () => {
  it("clears a false flag when the plain pass heard the word right: She 47, past 49, inning 52, proudly 96", () => {
    for (const score of [47, 49, 52, 96]) expect(finalStatus("miss", score, { kind: "same", heard: "x" })).toBe("ok");
  });
  it("keeps a real miss the plain pass also disputes: dinnertime 42, followed 54, windowsill 49", () => {
    for (const score of [42, 54, 49]) expect(finalStatus("miss", score, { kind: "said", heard: "y" })).toBe("miss");
  });
  it("keeps a very low score as a miss whatever the plain pass says: Jada 29, Nina 29", () => {
    expect(finalStatus("miss", 29, { kind: "same", heard: "jada" })).toBe("miss");
  });
  it("turns a passed word into a miss when it scored under 80 and the plain pass disagrees: cabinet 65, wrote 78, glancing 60", () => {
    for (const score of [65, 78, 60]) expect(finalStatus("ok", score, { kind: "said", heard: "z" })).toBe("miss");
    expect(finalStatus("ok", 61, { kind: "missing" })).toBe("miss");
  });
  it("trusts a confident live score over the plain pass's spelling: tied 91 heard as tide, bat 97 heard as back", () => {
    expect(finalStatus("ok", 91, { kind: "said", heard: "tide" })).toBe("ok");
    expect(finalStatus("ok", 97, { kind: "said", heard: "back" })).toBe("ok");
  });
  it("rescues a skipped word the plain pass heard in place, and leaves helped and small words alone", () => {
    expect(finalStatus("skip", null, { kind: "same", heard: "kept" })).toBe("ok");
    expect(finalStatus("skip", null, { kind: "missing" })).toBe("skip");
    expect(finalStatus("help", null, { kind: "same", heard: "x" })).toBe("help");
    expect(finalStatus("soft", null, { kind: "missing" })).toBe("soft");
  });
});

describe("reviewResult", () => {
  const story = "She put three slices of bread in a dark cabinet and wrote notes.";
  it("settles every word from both passes and rescores the read", () => {
    const r = read(story, [["miss", 47], ["ok", 95], ["ok", 97], ["ok", 94], ["soft", null], ["ok", 97], ["soft", null], ["ok", 94], ["ok", 64], ["ok", 65], ["ok", 73], ["ok", 78], ["ok", 95]]);
    const out = reviewResult(r, story, plain("she put 3 slices bread in a dark cabin and right rope notes"));
    expect(statuses(out)).toEqual(["ok", "ok", "ok", "ok", "soft", "ok", "soft", "ok", "ok", "miss", "ok", "miss", "ok"]);
    expect(out.missed).toEqual(["cabinet", "wrote"]);
    expect(out.ok).toBe(11);
    expect(out.acc).toBeCloseTo(11 / 13);
    expect(out.azureDetail!.words[9]).toMatchObject({ w: "cabinet", s: "miss", a: 65, p: "cabin" });
    expect(out.azureDetail!.words[11]).toMatchObject({ w: "wrote", s: "miss", p: "right" });
    expect(out.azureDetail!.words[0].p).toBeUndefined();
    expect(out.azureDetail!.review).toEqual({ words: 13, changed: 3, extras: ["rope"] });
    expect(out.azure?.completeness).toBe(85);
    expect(out.listener).toBe("azure");
  });
  it("returns the read untouched when there is nothing to review", () => {
    const r = read("A short read.", [["ok", 90], ["ok", 90], ["ok", 90]]);
    expect(reviewResult(r, "A short read.", [])).toBe(r);
    expect(reviewResult({ ...r, azureDetail: undefined }, "A short read.", plain("a short read"))).toMatchObject({ ok: 3 });
  });
  it("keeps insertions counting against accuracy", () => {
    const r = read("The big dog ran.", [["ok", 90], ["ok", 90], ["ok", 90], ["ok", 90]], { insertions: 2, acc: 4 / 6 });
    const out = reviewResult(r, "The big dog ran.", plain("the big red dog ran"));
    expect(out.insertions).toBe(2);
    expect(out.acc).toBeCloseTo(4 / 6);
  });
});
