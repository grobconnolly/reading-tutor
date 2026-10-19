import { describe, expect, it } from "vitest";
import {
  applyAzureSegment, AZURE_RULES, lastAzureScores, lastInsertions, lastListener, listenerNote, parseAzureJson, practicePassed, rememberAzureScores, summarizeAzure, wordAccuracy,
  type AzureAlignState, type AzureErrorType, type AzureSegment, type AzureWord,
} from "../azureAlign";
import { toReadWords } from "../words";

/** [word, errorType, accuracy] in Azure's order; continuous mode never sends Omission or Insertion, single-shot does. */
type W = [string, AzureErrorType?, number?];

function seg(words: W[], extra: Partial<AzureSegment> = {}): AzureSegment {
  const ws: AzureWord[] = words.map(([word, errorType = "None", accuracy = errorType === "Omission" ? 0 : 95], i) => ({
    word, errorType, accuracy, offsetMs: i * 400, durationMs: 300,
  }));
  return { text: ws.filter((w) => w.errorType !== "Omission").map((w) => w.word).join(" "), alternatives: [], words: ws, accuracy: 90, fluency: 85, completeness: 100, pronunciation: 88, durationMs: 400 * ws.length, ...extra };
}

function state(text: string): AzureAlignState {
  const words = toReadWords(text);
  return { words, status: words.map(() => "todo"), p: 0, azureAcc: words.map(() => null), inserted: [] };
}

describe("parseAzureJson", () => {
  const raw = JSON.stringify({
    Id: "x", RecognitionStatus: "Success", Offset: 7500000, Duration: 13800000, DisplayText: "Carlos was quick.",
    NBest: [{
      Confidence: 0.97, Lexical: "carlos was quick", ITN: "carlos was quick", MaskedITN: "carlos was quick", Display: "Carlos was quick.",
      PronunciationAssessment: { AccuracyScore: 92, FluencyScore: 88, CompletenessScore: 100, PronScore: 91 },
      Words: [
        { Word: "carlos", Offset: 7500000, Duration: 4000000, PronunciationAssessment: { AccuracyScore: 96, ErrorType: "None" } },
        { Word: "was", Offset: 11500000, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 100, ErrorType: "None" } },
        { Word: "quick", Offset: 13500000, Duration: 5000000, PronunciationAssessment: { AccuracyScore: 41, ErrorType: "Mispronunciation" } },
      ],
    }],
  });
  it("reads the best hypothesis, its scores and each word with ticks converted to milliseconds", () => {
    const s = parseAzureJson(raw)!;
    expect(s.text).toBe("Carlos was quick.");
    expect(s.alternatives).toEqual(["Carlos was quick."]);
    expect(s.accuracy).toBe(92);
    expect(s.fluency).toBe(88);
    expect(s.completeness).toBe(100);
    expect(s.pronunciation).toBe(91);
    expect(s.durationMs).toBe(1380);
    expect(s.words.map((w) => [w.word, w.errorType, w.accuracy])).toEqual([["carlos", "None", 96], ["was", "None", 100], ["quick", "Mispronunciation", 41]]);
    expect(s.words[0].offsetMs).toBe(750);
    expect(s.words[0].durationMs).toBe(400);
  });
  it("tolerates omitted words without offsets or scores, as single-shot assessments send them", () => {
    const s = parseAzureJson(JSON.stringify({ NBest: [{ Display: "", Words: [{ Word: "volcano", PronunciationAssessment: { ErrorType: "Omission" } }] }] }))!;
    expect(s.words).toEqual([{ word: "volcano", errorType: "Omission", accuracy: 0, offsetMs: 0, durationMs: 0 }]);
  });
  it("returns null for nothing, bad JSON or an empty hypothesis", () => {
    expect(parseAzureJson(null)).toBeNull();
    expect(parseAzureJson("")).toBeNull();
    expect(parseAzureJson("{not json")).toBeNull();
    expect(parseAzureJson(JSON.stringify({ RecognitionStatus: "NoMatch" }))).toBeNull();
    expect(parseAzureJson(JSON.stringify({ NBest: [{ Display: "", Words: [] }] }))).toBeNull();
  });
});

describe("applyAzureSegment: continuous mode (heard words only)", () => {
  it("marks words read well as ok and keeps their scores", () => {
    const st = state("Carlos was the youngest player.");
    expect(applyAzureSegment(st, seg([["carlos", "None", 96], ["was", "None", 100], ["the", "None", 99], ["youngest", "None", 88], ["player", "None", 93]]))).toBe(5);
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(st.azureAcc).toEqual([96, 100, 99, 88, 93]);
  });
  it("flags a word she said but got wrong as miss, by Azure's tag or by a score under the threshold", () => {
    const st = state("Nina noticed the bread on the counter.");
    applyAzureSegment(st, seg([["nina", "Mispronunciation", 32], ["noticed", "None", AZURE_RULES.missBelow - 1], ["the", "None", 90], ["bread", "None", AZURE_RULES.missBelow], ["on", "None", 95], ["the", "None", 95], ["counter", "None", 97]]));
    expect(st.status).toEqual(["miss", "miss", "ok", "ok", "ok", "ok", "ok"]);
    expect(st.azureAcc[0]).toBe(32);
    expect(st.p).toBe(7);
  });
  it("marks words she jumped over as skipped (small ones as soft) through the lookahead", () => {
    const st = state("the bread had fuzzy green spots on it");
    applyAzureSegment(st, seg([["the"], ["bread"], ["had"], ["spots"], ["on"], ["it"]]));
    expect(st.status).toEqual(["ok", "ok", "ok", "skip", "skip", "ok", "ok", "ok"]);
    expect(st.azureAcc[3]).toBeNull();
    expect(st.azureAcc[5]).toBe(95);
  });
  it("joins a name the recognizer split and scores it by the pieces", () => {
    const st = state("Carlos was the youngest player.");
    expect(applyAzureSegment(st, seg([["car", "None", 70], ["los", "None", 80], ["was"], ["the"], ["youngest"], ["player"]]))).toBe(5);
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(st.azureAcc[0]).toBe(75);
  });
  it("joins three pieces, and a misread piece makes the whole word a miss", () => {
    const st = state("Carlos was tired.");
    applyAzureSegment(st, seg([["car", "None", 80], ["lo", "Mispronunciation", 20], ["s", "None", 80], ["was"], ["tired"]]));
    expect(st.status).toEqual(["miss", "ok", "ok"]);
    expect(st.p).toBe(3);
  });
  it("takes one heard word for two story words", () => {
    const st = state("the base ball game");
    applyAzureSegment(st, seg([["the"], ["baseball", "None", 91], ["game"]]));
    expect(st.status).toEqual(["ok", "ok", "ok", "ok"]);
    expect(st.azureAcc[1]).toBe(91);
    expect(st.azureAcc[2]).toBe(91);
  });
  it("does not move on a word beyond the lookahead window", () => {
    const st = state("one two three four five six seven");
    expect(applyAzureSegment(st, seg([["six"]]))).toBe(0);
    expect(st.p).toBe(0);
  });
  it("never downgrades a helped word", () => {
    const st = state("Max is a big dog.");
    st.status[0] = "help";
    st.p = 1;
    applyAzureSegment(st, seg([["dog"]]));
    expect(st.status).toEqual(["help", "soft", "soft", "skip", "ok"]);
  });
});

describe("applyAzureSegment: words she added or swapped (Rob's iPad cases)", () => {
  it("counts words with no place in the story as insertions and leaves the story words alone", () => {
    const st = state("Watch the ball all the way to the bat.");
    expect(applyAzureSegment(st, seg([["watch"], ["the"], ["big"], ["red"], ["ball"], ["all"], ["the"], ["way"], ["to"], ["the"], ["bat"]]))).toBe(9);
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(st.inserted).toEqual(["big", "red"]);
  });
  it("pairs an unplaced word with the story word the next match jumps, as a substitution (saw for was)", () => {
    const st = state("It was a long day.");
    applyAzureSegment(st, seg([["it"], ["saw"], ["a"], ["long"], ["day"]]));
    expect(st.status).toEqual(["ok", "miss", "ok", "ok", "ok"]);
    expect(st.azureAcc[1]).toBe(0);
    expect(st.inserted).toEqual([]);
  });
  it("flags tried said as tired and from said as form, whether Azure returns her word or a low-scored story word", () => {
    const a = state("She tried to open the box from the shelf.");
    applyAzureSegment(a, seg([["she"], ["tired"], ["to"], ["open"], ["the"], ["box"], ["form"], ["the"], ["shelf"]]));
    expect(a.status).toEqual(["ok", "miss", "ok", "ok", "ok", "ok", "miss", "ok", "ok"]);
    expect(a.inserted).toEqual([]);
    const b = state("She tried to open the box from the shelf.");
    applyAzureSegment(b, seg([["she"], ["tried", "Mispronunciation", 35], ["to"], ["open"], ["the"], ["box"], ["from", "None", 48], ["the"], ["shelf"]]));
    expect(b.status).toEqual(["ok", "miss", "ok", "ok", "ok", "ok", "miss", "ok", "ok"]);
  });
  it("a swap plus an extra word: one substitution, one insertion", () => {
    const st = state("the small ball rolled");
    applyAzureSegment(st, seg([["the"], ["big"], ["red"], ["ball"], ["rolled"]]));
    expect(st.status).toEqual(["ok", "miss", "ok", "ok"]);
    expect(st.inserted).toEqual(["red"]);
  });
  it("does not count a repeat or a self-correction", () => {
    const st = state("Carlos was the youngest player.");
    applyAzureSegment(st, seg([["carlos"], ["was"], ["carlos"], ["was"], ["the"], ["youngest"], ["player"]]));
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(st.inserted).toEqual([]);
  });
  it("does not count a word from further down the page as an addition", () => {
    const st = state("one two three four five six seven eight nine ten");
    applyAzureSegment(st, seg([["one"], ["eight"]]));
    expect(st.inserted).toEqual([]);
    expect(st.p).toBe(1);
  });
  it("counts additions at the end of a segment too", () => {
    const st = state("The dog ran.");
    applyAzureSegment(st, seg([["the"], ["dog"], ["really"], ["fast"]]));
    expect(st.status).toEqual(["ok", "ok", "todo"]);
    expect(st.inserted).toEqual(["really", "fast"]);
  });
});

describe("applyAzureSegment: single-shot tags (Omission, Insertion)", () => {
  it("records an inserted filler word without touching the story words", () => {
    const st = state("Her brother suggested a volcano.");
    applyAzureSegment(st, seg([["her"], ["brother"], ["um", "Insertion", 0], ["suggested"], ["a"], ["volcano"]]));
    expect(st.status).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(st.inserted).toEqual(["um"]);
  });
  it("joins inserted pieces of a split name, unscored", () => {
    const st = state("Carlos was tired.");
    applyAzureSegment(st, seg([["carlos", "Omission"], ["car", "Insertion", 0], ["los", "Insertion", 0], ["was"], ["tired"]]));
    expect(st.status).toEqual(["ok", "ok", "ok"]);
    expect(st.azureAcc).toEqual([null, 95, 95]);
  });
  it("trusts a run of omissions right before a heard word to jump past the lookahead window", () => {
    const st = state("one two three four five six seven eight");
    applyAzureSegment(st, seg([["one"], ["two", "Omission"], ["three", "Omission"], ["four", "Omission"], ["five", "Omission"], ["six", "Omission"], ["seven"], ["eight"]]));
    expect(st.status).toEqual(["ok", "skip", "skip", "skip", "skip", "skip", "ok", "ok"]);
    expect(st.p).toBe(8);
  });
  it("ignores omissions after the last heard word: she may just be pausing", () => {
    const st = state("one two three");
    applyAzureSegment(st, seg([["one"], ["two", "Omission"], ["three", "Omission"]]));
    expect(st.status).toEqual(["ok", "todo", "todo"]);
    expect(st.p).toBe(1);
  });
});

describe("summarizeAzure", () => {
  it("is null when Azure never scored a segment", () => {
    expect(summarizeAzure(state("a b c"), [])).toBeNull();
  });
  it("averages word scores over what she reached, counting skipped and helped words as 0 and leaving soft words unscored", () => {
    const st = state("Max is a big dog today.");
    st.status = ["ok", "soft", "soft", "skip", "miss", "help"];
    st.azureAcc = [90, null, null, null, 40, null];
    st.p = 6;
    const s = summarizeAzure(st, [{ fluency: 80, durationMs: 1000 }])!;
    expect(s.accuracy).toBe(Math.round((90 + 0 + 40 + 0) / 4));
    expect(s.completeness).toBe(50); // ok + soft + soft out of 6
    expect(s.fluency).toBe(80);
  });
  it("weights fluency by each utterance's length and ignores words not yet reached", () => {
    const st = state("one two three four");
    st.status = ["ok", "ok", "todo", "todo"];
    st.azureAcc = [100, 80, null, null];
    st.p = 2;
    const s = summarizeAzure(st, [{ fluency: 100, durationMs: 3000 }, { fluency: 60, durationMs: 1000 }])!;
    expect(s.fluency).toBe(90);
    expect(s.accuracy).toBe(90);
    expect(s.completeness).toBe(100);
  });
});

describe("word practice", () => {
  it("takes the practice word's own score, 0 for an omitted word", () => {
    expect(wordAccuracy(seg([["volcano", "None", 83]]), "volcano")).toBe(83);
    expect(wordAccuracy(seg([["volcano", "Omission"], ["banana", "Insertion", 0]]), "volcano")).toBe(0);
  });
  it("scores split pieces by the utterance, and something else entirely as 0", () => {
    expect(wordAccuracy(seg([["vol", "Insertion", 0], ["cano", "Insertion", 0]], { accuracy: 77 }), "volcano")).toBe(77);
    expect(wordAccuracy(seg([["banana", "Insertion", 0]]), "volcano")).toBe(0);
    expect(wordAccuracy(seg([]), "volcano")).toBeNull();
  });
  it("passes at the threshold with Azure, and by transcript without it", () => {
    expect(practicePassed({ alts: [], accuracy: AZURE_RULES.practicePass }, "volcano")).toBe(true);
    expect(practicePassed({ alts: ["volcano"], accuracy: AZURE_RULES.practicePass - 1 }, "volcano")).toBe(false);
    expect(practicePassed({ alts: ["a vol cano"], accuracy: null }, "volcano")).toBe(true);
    expect(practicePassed({ alts: ["banana"], accuracy: null }, "volcano")).toBe(false);
  });
});

describe("hand-off to the results screen", () => {
  it("keeps the latest scores, listener and added-word count, or none", () => {
    rememberAzureScores({ accuracy: 90, fluency: 80, completeness: 70 }, "azure", 3);
    expect(lastAzureScores()).toEqual({ accuracy: 90, fluency: 80, completeness: 70 });
    expect(lastListener()).toBe("azure");
    expect(lastInsertions()).toBe(3);
    rememberAzureScores(null, "browser");
    expect(lastAzureScores()).toBeNull();
    expect(lastListener()).toBe("browser");
    rememberAzureScores(null);
    expect(lastListener()).toBeNull();
  });
  it("explains which engine listened and what the browser cannot catch", () => {
    expect(listenerNote("azure")).toMatch(/Azure/);
    expect(listenerNote("browser", "Safari")).toMatch(/Safari.*could not be checked/);
    expect(listenerNote("mixed", "Safari")).toMatch(/Azure, then Safari/);
    expect(listenerNote(null)).toBeNull();
  });
});
