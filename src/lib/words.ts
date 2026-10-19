/* Word matching and reading alignment, ported from version 1. Pure functions; unit-tested. */

export type WordStatus = "todo" | "ok" | "soft" | "skip" | "help";

export interface ReadWord {
  /** As displayed, with punctuation. */
  disp: string;
  /** Normalized for matching. */
  norm: string;
}

/** The minimal state `advance` works on. The live reading state and interim previews both satisfy it. */
export interface AlignState {
  words: { norm: string }[];
  status: WordStatus[];
  /** Index of the next word to read. */
  p: number;
}

/** Short function words recognizers often drop. Skipping one counts as read ("soft"). */
export const SMALL = new Set(["a","an","the","of","to","and","in","is","it","on","at","as","or","for","was","his","her","he","she","i","we","by"]);

const NUM: Record<string, string> = {"0":"zero","1":"one","2":"two","3":"three","4":"four","5":"five","6":"six","7":"seven","8":"eight","9":"nine","10":"ten","100":"hundred"};

/** Homophones and near-homophones that count as the same word when heard. */
const SAME: Record<string, string[]> = {"two":["to","too"],"to":["two","too"],"too":["to","two"],"there":["their","they're"],"their":["there","they're"],"know":["no"],"no":["know"],"right":["write"],"one":["won"],"won":["one"],"four":["for"],"for":["four"],"its":["it's"],"hole":["whole"],"whole":["hole"],"sea":["see"],"see":["sea"],"tail":["tale"],"eight":["ate"],"hour":["our"],"our":["hour"],"flour":["flower"],"flower":["flour"],"mr":["mister"],"ms":["miss","mizz"]};

export function norm(w: string): string {
  return String(w).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]/g, "");
}

/** Levenshtein edit distance. */
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Does a heard token count as the target word? Forgiving of accents, plurals and homophones. */
export function wordMatch(heard: string, target: string): boolean {
  let h = norm(heard);
  const t = norm(target);
  if (!h || !t) return false;
  if (NUM[h]) h = NUM[h];
  if (h === t) return true;
  if ((SAME[t] || []).map(norm).includes(h)) return true;
  if (t.length >= 5 && lev(h, t) <= 1) return true;
  if (t.length >= 8 && lev(h, t) <= 2) return true;
  if (t.length >= 4 && (h === t + "s" || t === h + "s")) return true;
  return false;
}

export function tokenize(text: string): string[] {
  return String(text).split(/[\s\-–—]+/).map(norm).filter(Boolean);
}

/** Split passage text into displayable words, dropping tokens that are pure punctuation. */
export function toReadWords(text: string): ReadWord[] {
  return text.split(/\s+/).filter(Boolean).map((d) => ({ disp: d, norm: norm(d) })).filter((w) => w.norm);
}

/** Strip leading/trailing punctuation for speaking a word aloud. */
export function cleanWord(disp: string): string {
  return disp.replace(/^[^\w']+|[^\w']+$/g, "");
}

/**
 * Advance the reading pointer with one heard token. Looks ahead up to 4 words so a skipped word
 * doesn't stall the reader; words jumped over are marked "skip", or "soft" if they are small
 * function words that recognizers routinely drop.
 */
export function advance(st: AlignState, tok: string): boolean {
  const n = st.words.length;
  const end = Math.min(st.p + 4, n - 1);
  for (let j = st.p; j <= end; j++) {
    if (wordMatch(tok, st.words[j].norm)) {
      for (let k = st.p; k < j; k++) {
        if (st.status[k] === "todo") st.status[k] = SMALL.has(st.words[k].norm) ? "soft" : "skip";
      }
      st.status[j] = "ok";
      st.p = j + 1;
      return true;
    }
  }
  return false;
}

export function shuffle<T>(a: T[]): T[] {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
