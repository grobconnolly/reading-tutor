/* Azure Pronunciation Assessment results mapped onto the story (milestone 3, spec 6.1 step 4 and 6.2 step 2).
 * Pure functions; unit-tested with fake SDK output.
 *
 * In continuous mode the service returns only the words it heard, each with an accuracy score; it does not tag
 * Omission or Insertion across a long reference text. So the lookahead alignment in words.ts stays the matcher:
 * skipped words come from the lookahead (as in version 1), and Azure adds what the browser recognizer never could,
 * a per-word score that flags a word she said but got wrong ("miss"). Single-utterance assessments (word practice)
 * do carry Omission/Insertion tags, and those are handled too. */

import { advance, advanceTokens, norm, SMALL, transcriptHasWord, wordMatch, type AlignState } from "./words";

/** Thresholds, in one place so they are easy to tune. */
export const AZURE_RULES = {
  /** A word scored under this is a misread. Azure itself labels such words Mispronunciation. */
  missBelow: 60,
  /** Word practice passes at this word accuracy or higher (spec 6.2 step 2: "tune this"). */
  practicePass: 70,
  /** Omission tags right before a heard word may carry the pointer this far past the lookahead window. */
  maxOmissionJump: 12,
  /** Juno says "Just the words on the page." once a sentence has this many added words; never for a single slip. */
  nudgeInsertionsAt: 2,
} as const;

export type AzureErrorType = "None" | "Omission" | "Insertion" | "Mispronunciation" | "UnexpectedBreak" | "MissingBreak" | "Monotone";

export interface AzureWord {
  word: string;
  errorType: AzureErrorType;
  /** 0..100. Omitted words have no score and get 0. */
  accuracy: number;
  offsetMs: number;
  durationMs: number;
}

/** One recognized utterance with its assessment. */
export interface AzureSegment {
  /** Display text of the best hypothesis. */
  text: string;
  /** Every hypothesis Azure offered, best first (usually just one with assessment on). */
  alternatives: string[];
  words: AzureWord[];
  accuracy: number;
  fluency: number;
  completeness: number;
  pronunciation: number;
  durationMs: number;
}

/** Whole-session scores, 0..100 each, as the spec's azure_scores. */
export interface AzureScores {
  accuracy: number;
  fluency: number;
  completeness: number;
}

const ERROR_TYPES = new Set<AzureErrorType>(["None", "Omission", "Insertion", "Mispronunciation", "UnexpectedBreak", "MissingBreak", "Monotone"]);

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Parse the SDK's SpeechServiceResponse_JsonResult. Null when it holds no hypothesis. */
export function parseAzureJson(raw: string | null | undefined): AzureSegment | null {
  if (!raw) return null;
  let j: { Duration?: unknown; NBest?: unknown[] };
  try { j = JSON.parse(raw) as typeof j; } catch { return null; }
  const nbest = Array.isArray(j.NBest) ? (j.NBest as Record<string, unknown>[]) : [];
  const nb = nbest[0];
  if (!nb) return null;
  const pa = (nb.PronunciationAssessment ?? {}) as Record<string, unknown>;
  const words: AzureWord[] = [];
  for (const w of Array.isArray(nb.Words) ? (nb.Words as Record<string, unknown>[]) : []) {
    const word = typeof w.Word === "string" ? w.Word : "";
    if (!word) continue;
    const wpa = (w.PronunciationAssessment ?? {}) as Record<string, unknown>;
    const et = typeof wpa.ErrorType === "string" && ERROR_TYPES.has(wpa.ErrorType as AzureErrorType) ? (wpa.ErrorType as AzureErrorType) : "None";
    words.push({ word, errorType: et, accuracy: num(wpa.AccuracyScore), offsetMs: num(w.Offset) / 10000, durationMs: num(w.Duration) / 10000 });
  }
  const alternatives = nbest
    .map((n) => (typeof n.Display === "string" && n.Display) || (typeof n.Lexical === "string" && n.Lexical) || "")
    .filter(Boolean);
  const text = alternatives[0] ?? "";
  if (!text && !words.length) return null;
  return {
    text,
    alternatives,
    words,
    accuracy: num(pa.AccuracyScore),
    fluency: num(pa.FluencyScore),
    completeness: num(pa.CompletenessScore),
    pronunciation: num(pa.PronScore),
    durationMs: num(j.Duration) / 10000,
  };
}

/* ---------- reading: segment -> story statuses ---------- */

/** The reading state plus Azure's per-word accuracy (null until Azure heard that word) and the words she added. */
export interface AzureAlignState extends AlignState {
  azureAcc: (number | null)[];
  /** Words she said that have no place in the story (insertions), in the order heard. Errors, but not practice words. */
  inserted: string[];
}

const spoken = (w: AzureWord) => w.errorType !== "Omission" && w.errorType !== "Insertion";
const misread = (w: AzureWord) => w.errorType === "Mispronunciation" || w.accuracy < AZURE_RULES.missBelow;

/** How far past the lookahead window a heard word may still be "reading ahead" rather than an insertion. */
const FAR_AHEAD = 12;
/** How far back a heard word may match an already-read word and count as a repeat or self-correction. */
const REPEAT_BACK = 4;
/** A jumped line: this many consecutive heard words matching consecutive story words up to this far ahead. */
const JUMP_CONFIRM = 3;
const JUMP_SCAN = 40;

/** The word just matched (at p-1) was heard with this score: keep the score and downgrade a misread. */
function settle(st: AzureAlignState, accuracy: number, bad: boolean): void {
  const j = st.p - 1;
  if (bad) st.status[j] = "miss";
  st.azureAcc[j] = accuracy;
}

/** She said these words right before a match that jumped story words: pair them up as substitutions ("saw" for
 *  "was" marks "was" misread, not skipped); whatever is left over was added to the story. */
function resolvePending(st: AzureAlignState, pending: string[], from: number, to: number): void {
  let k = 0;
  for (let i = from; i < to && k < pending.length; i++) {
    if (st.status[i] !== "skip" && st.status[i] !== "soft") continue;
    st.status[i] = "miss";
    st.azureAcc[i] = 0;
    k++;
  }
  for (; k < pending.length; k++) st.inserted.push(pending[k]);
  pending.length = 0;
}

/** A word she just read again (or corrected herself on): not an error. */
function isRepeat(st: AlignState, tok: string): boolean {
  for (let i = Math.max(0, st.p - REPEAT_BACK); i < st.p; i++) if (wordMatch(tok, st.words[i].norm)) return true;
  return false;
}

/**
 * She jumped a line: the heard word and the next two match three consecutive story words beyond the lookahead window.
 * Returns where the first one lands, or -1. Without this, everything read after a jump would look like added words
 * until stall help caught up.
 */
function findJump(st: AlignState, ws: AzureWord[], i: number): number {
  const toks: string[] = [];
  for (let j = i; j < ws.length && toks.length < JUMP_CONFIRM; j++) {
    if (!spoken(ws[j])) break;
    const t = norm(ws[j].word);
    if (t) toks.push(t);
  }
  if (toks.length < JUMP_CONFIRM) return -1;
  const n = st.words.length;
  for (let k = st.p + 5; k + JUMP_CONFIRM <= n && k <= st.p + JUMP_SCAN; k++) {
    if (toks.every((t, c) => wordMatch(t, st.words[k + c].norm))) return k;
  }
  return -1;
}

/** A word that sits further ahead than the lookahead reaches: she may have jumped a line, which stall help sorts out. */
function isFarAhead(st: AlignState, tok: string): boolean {
  const n = st.words.length;
  for (let i = st.p + 5; i < Math.min(n, st.p + 1 + FAR_AHEAD); i++) if (wordMatch(tok, st.words[i].norm)) return true;
  return false;
}

/**
 * Apply one recognized segment. Heard words advance the pointer through the lookahead matcher; a heard word Azure
 * scored under the threshold (or tagged Mispronunciation) is marked "miss" instead of "ok". A heard word with no
 * place in the story becomes a substitution for a story word the next match jumps over, or else an insertion in
 * `st.inserted`. Returns how many story words were advanced.
 */
export function applyAzureSegment(st: AzureAlignState, seg: AzureSegment): number {
  const start = st.p;
  const ws = seg.words;
  let omitted = 0;
  const pending: string[] = [];
  const placed = (from: number) => resolvePending(st, pending, from, st.p - 1);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.errorType === "Omission") { omitted++; continue; }
    if (w.errorType === "Insertion") {
      // Tagged by a single-utterance assessment. Try the run as plain tokens first: a name the recognizer split
      // ("car", "los") still joins up to the story word, unscored; what does not fit was added.
      const run: string[] = [];
      while (i < ws.length && ws[i].errorType === "Insertion" && run.length < 3) run.push(norm(ws[i++].word));
      i--;
      const before = st.p;
      if (advanceTokens(st, run.filter(Boolean)) === 0) pending.push(...run.filter(Boolean));
      else placed(before);
      omitted = 0;
      continue;
    }
    const tok = norm(w.word);
    if (!tok) continue;
    const bad = misread(w);
    const before = st.p;
    if (advance(st, tok)) { settle(st, w.accuracy, bad); placed(before); omitted = 0; continue; }
    // Azure tagged k reference words omitted right before this one: trust it past the window if the word fits there.
    if (omitted > 0 && omitted <= AZURE_RULES.maxOmissionJump) {
      const k = st.p + omitted;
      if (k < st.words.length && wordMatch(tok, st.words[k].norm)) {
        for (let x = st.p; x < k; x++) if (st.status[x] === "todo") st.status[x] = SMALL.has(st.words[x].norm) ? "soft" : "skip";
        st.status[k] = "ok";
        st.p = k + 1;
        settle(st, w.accuracy, bad);
        placed(before);
        omitted = 0;
        continue;
      }
    }
    omitted = 0;
    // Split words: join with the next one or two heard words ("car los" for "Carlos").
    const n1 = ws[i + 1] && spoken(ws[i + 1]) ? ws[i + 1] : null;
    const n2 = n1 && ws[i + 2] && spoken(ws[i + 2]) ? ws[i + 2] : null;
    if (n1 && advance(st, tok + norm(n1.word))) {
      settle(st, (w.accuracy + n1.accuracy) / 2, bad || misread(n1));
      placed(before);
      i += 1;
      continue;
    }
    if (n1 && n2 && advance(st, tok + norm(n1.word) + norm(n2.word))) {
      settle(st, (w.accuracy + n1.accuracy + n2.accuracy) / 3, bad || misread(n1) || misread(n2));
      placed(before);
      i += 2;
      continue;
    }
    // One heard token for two story words ("baseball" for "base ball").
    const a = st.words[st.p], b = st.words[st.p + 1];
    if (a && b && a.norm.length >= 2 && b.norm.length >= 2 && wordMatch(tok, a.norm + b.norm)) {
      st.status[st.p] = st.status[st.p + 1] = bad ? "miss" : "ok";
      st.azureAcc[st.p] = st.azureAcc[st.p + 1] = w.accuracy;
      st.p += 2;
      resolvePending(st, pending, before, before);
      continue;
    }
    // Nowhere to put it near the pointer. Three words in a row from further down the page mean she jumped a line:
    // follow her there (the words in between are skipped) and give the words heard before that the benefit of the doubt.
    const k = findJump(st, ws, i);
    if (k >= 0) {
      for (let x = st.p; x < k; x++) if (st.status[x] === "todo") st.status[x] = SMALL.has(st.words[x].norm) ? "soft" : "skip";
      st.status[k] = "ok";
      st.p = k + 1;
      settle(st, w.accuracy, bad);
      pending.length = 0;
      continue;
    }
    // A repeat is fine, and a lone word from further down the page is noise, not an addition.
    if (isRepeat(st, tok) || isFarAhead(st, tok)) continue;
    pending.push(tok);
  }
  resolvePending(st, pending, st.p, st.p); // whatever is still pending at the end of the segment was added
  return st.p - start;
}

/* ---------- reading: whole-session scores ---------- */

export interface AzureSegmentStat {
  fluency: number;
  durationMs: number;
}

/**
 * Session scores in the spirit of Azure's own continuous-mode sample: accuracy averages the word scores over everything
 * she reached, with skipped and helped words counting 0; fluency weights each utterance's fluency by its length;
 * completeness is the share of reached words she read right. Null when Azure never heard a segment.
 */
export function summarizeAzure(st: AzureAlignState, segs: AzureSegmentStat[]): AzureScores | null {
  if (!segs.length) return null;
  let sum = 0, scored = 0, right = 0, attempted = 0;
  for (let i = 0; i < st.p; i++) {
    const s = st.status[i];
    if (s === "todo") continue;
    attempted++;
    if (s === "soft") { right++; continue; } // a small word the recognizer dropped: counted as read, left unscored
    if (s === "skip" || s === "help") { scored++; continue; } // 0 points
    const a = st.azureAcc[i];
    if (a != null) { sum += a; scored++; }
    if (s === "ok") right++;
  }
  const dur = segs.reduce((t, s) => t + s.durationMs, 0);
  const fluency = dur > 0 ? segs.reduce((t, s) => t + s.fluency * s.durationMs, 0) / dur : segs.reduce((t, s) => t + s.fluency, 0) / segs.length;
  return {
    accuracy: Math.round(scored ? sum / scored : 0),
    fluency: Math.round(fluency),
    completeness: Math.round(attempted ? Math.min(100, (100 * right) / attempted) : 0),
  };
}

/* ---------- word practice ---------- */

/** Azure's accuracy for the practice word in a single-utterance assessment; null when Azure reported nothing. */
export function wordAccuracy(seg: AzureSegment, word: string): number | null {
  const target = norm(word);
  if (!target || !seg.words.length) return null;
  const hit = seg.words.find((w) => w.errorType !== "Insertion" && wordMatch(w.word, target));
  if (hit) return hit.errorType === "Omission" ? 0 : hit.accuracy;
  // Azure only heard pieces ("vol cano"): if they add up to the word, score it by the utterance.
  const heard = seg.words.filter((w) => w.errorType !== "Omission");
  if (heard.length && transcriptHasWord(heard.map((w) => w.word).join(" "), target)) return seg.accuracy;
  return 0;
}

export interface PracticeHeard {
  /** Transcripts heard, best first. */
  alts: string[];
  /** Azure's accuracy for the word, or null when the browser recognizer listened. */
  accuracy: number | null;
}

/** Did she say the practice word well enough? Azure's score decides when it listened; otherwise the transcript must contain the word. */
export function practicePassed(heard: PracticeHeard, word: string): boolean {
  if (heard.accuracy != null) return heard.accuracy >= AZURE_RULES.practicePass;
  return heard.alts.some((a) => transcriptHasWord(a, word));
}

/* ---------- hand-off to the results screen ---------- */

let last: AzureScores | null = null;
let lastWho: "azure" | "browser" | "mixed" | null = null;
let lastAdded = 0;

/**
 * The reading screen leaves the latest session's scores (and which engine heard it) here and the results screen shows
 * them. TODO(milestone 2): pass ReadResult.azure and .listener through the session save instead and persist the scores
 * in sessions.azure_scores.
 */
export function rememberAzureScores(scores: AzureScores | null | undefined, listener?: "azure" | "browser" | "mixed" | null, insertions = 0): void {
  last = scores ?? null;
  lastWho = listener ?? null;
  lastAdded = insertions;
}

/** How many words she added in the latest read. */
export function lastInsertions(): number {
  return lastAdded;
}

export function lastAzureScores(): AzureScores | null {
  return last;
}

export function lastListener(): "azure" | "browser" | "mixed" | null {
  return lastWho;
}

/** One line for the results screen: who listened, and what that means for the misread flags. */
export function listenerNote(listener: "azure" | "browser" | "mixed" | null | undefined, browserName = "the browser"): string | null {
  if (listener === "azure") return "Heard by Azure, which checks how each word was said.";
  if (listener === "browser") return `Heard by ${browserName}: words said wrong could not be checked.`;
  if (listener === "mixed") return `Heard by Azure, then ${browserName} after it dropped out: later words said wrong could not be checked.`;
  return null;
}
