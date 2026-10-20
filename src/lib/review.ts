/* The second pass over a read (milestone 3 follow-up). Pure functions; unit-tested on Stella's real reads.
 *
 * Azure's live assessment is given the story and leans toward it: a word said wrong often comes back as the story word
 * with a passing score ("cabin" for "cabinet" scored 65), and a word said right can score in the 40s ("She" at the
 * start of a sentence, "past", "inning"). A plain transcription of the same audio, with no story text, errs the other
 * way: it hears what was said, but spells homophones freely ("tide" for "tied"). Each pass is unreliable alone; where
 * they agree they are right, so the final status of a word comes from both. */

import { AZURE_RULES, type AzureDetail } from "./azureAlign";
import { scoreReading, type ReadResult } from "./scoring";
import { lev, norm, sameWord, toReadWords, type WordStatus } from "./words";

export interface PlainWord {
  w: string;
  /** Seconds from the start of the recording. */
  t: number;
  d: number;
}

export const REVIEW_RULES = {
  /** A live score under this stays a miss whatever the plain pass heard: that low is never a word read right. */
  keepMissBelow: 30,
  /** A live score under this becomes a miss when the plain pass heard something else. */
  missBelowIfPlainDiffers: 80,
} as const;

/** Does the plain pass's word count as the story word? Exact, number or homophone, or a one-letter spelling slip on a long word. */
export function plainSame(heard: string, story: string): boolean {
  const h = norm(heard), s = norm(story);
  if (!h || !s) return false;
  if (sameWord(h, s)) return true;
  return h.length >= 5 && s.length >= 5 && lev(h, s) <= 1;
}

export type PlainVerdict = { kind: "same"; heard: string } | { kind: "said"; heard: string } | { kind: "missing" };

/**
 * Line the plain transcript up with the story (longest common subsequence, then pair each unmatched story word with
 * an unmatched heard word at the same spot as a substitution). Returns one verdict per story word and the extras.
 */
export function alignPlain(storyNorms: string[], heard: string[]): { verdicts: PlainVerdict[]; extras: string[] } {
  const n = storyNorms.length, m = heard.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = plainSame(heard[j], storyNorms[i]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const verdicts: PlainVerdict[] = new Array(n).fill({ kind: "missing" });
  // Everything between two matched words shares a gap; inside a gap, unmatched story words and unmatched heard
  // words pair up in order as substitutions, and what is left over was skipped or added.
  const missing: { i: number; gap: number }[] = [];
  const extras: { w: string; gap: number; used: boolean }[] = [];
  let i = 0, j = 0, gap = 0;
  while (i < n && j < m) {
    if (plainSame(heard[j], storyNorms[i])) { verdicts[i] = { kind: "same", heard: heard[j] }; i++; j++; gap++; }
    else if (L[i + 1][j] > L[i][j + 1]) { missing.push({ i, gap }); i++; }
    else { extras.push({ w: heard[j], gap, used: false }); j++; }
  }
  for (; i < n; i++) missing.push({ i, gap });
  for (; j < m; j++) extras.push({ w: heard[j], gap, used: false });
  for (const mw of missing) {
    const x = extras.find((e) => e.gap === mw.gap && !e.used);
    if (x) { x.used = true; verdicts[mw.i] = { kind: "said", heard: x.w }; }
  }
  return { verdicts, extras: extras.filter((e) => !e.used).map((e) => e.w) };
}

/** The final status of one word from the live status and score and the plain pass's verdict. */
export function finalStatus(status: WordStatus, score: number | null, verdict: PlainVerdict): WordStatus {
  if (status === "help" || status === "todo" || status === "soft") return status;
  const agrees = verdict.kind === "same";
  if (status === "miss") {
    if (score != null && score < REVIEW_RULES.keepMissBelow) return "miss";
    return agrees ? "ok" : "miss";
  }
  if (status === "skip") return agrees ? "ok" : "skip";
  // ok: the plain pass can only take it away when the live score was not confident either
  if (!agrees && score != null && score < REVIEW_RULES.missBelowIfPlainDiffers) return "miss";
  return status;
}

/**
 * Apply the plain pass to a finished read: new statuses, score and missed words, and the per-word record gains what
 * the plain pass heard where it differed. Returns the same result when there is nothing to review.
 */
export function reviewResult(result: ReadResult, storyText: string, plain: PlainWord[]): ReadResult {
  const d = result.azureDetail;
  if (!d || !d.words.length || !plain.length) return result;
  const words = toReadWords(storyText);
  const p = d.words.length;
  const heard = plain.map((w) => norm(w.w)).filter(Boolean);
  const { verdicts, extras } = alignPlain(words.map((w) => w.norm), heard);
  const status: WordStatus[] = words.map((_, i) => (i < p ? d.words[i].s : "todo"));
  let changed = 0;
  const detailWords = d.words.map((w, i) => {
    const v = verdicts[i] ?? { kind: "missing" as const };
    const next = finalStatus(w.s, w.a, v);
    if (next !== w.s) { status[i] = next; changed++; }
    const out = { ...w, s: next };
    if (v.kind === "said") out.p = v.heard;
    else if (v.kind === "missing") out.p = "";
    else delete out.p;
    return out;
  });
  const helps = result.helps;
  const insertions = result.insertions ?? 0;
  const rescored = scoreReading(words, status, p, result.startedAt, result.endedAt, helps, insertions);
  const azureScores = d.scores && result.azure ? { ...result.azure, completeness: Math.round(Math.min(100, (100 * rescored.ok) / Math.max(1, rescored.attempted))) } : result.azure;
  return {
    ...result,
    ...rescored,
    azure: azureScores,
    listener: result.listener,
    azureDetail: { ...d, words: detailWords, review: { words: heard.length, changed, extras: extras.slice(0, 50) } },
    recording: result.recording,
    insertions,
  };
}

/** Thresholds live beside the live-pass ones so they are tuned together. */
export const BOTH_RULES = { live: AZURE_RULES, review: REVIEW_RULES };
