/* Word timing for Juno's cloud voice.
 *
 * Azure's REST text-to-speech endpoint returns audio only, with no word boundaries. The server measures the MP3
 * exactly (mp3Duration) and spreads that time across the words by how long each takes to say (estimateWordStarts).
 * "Hear it first" highlights words from these start times. Pure functions, shared by the server and the tests. */

/** Seconds of silence assumed before the first word and after the last one in an Azure clip. */
export const LEAD_SILENCE = 0.1;
export const TAIL_SILENCE = 0.3;

/** Rough syllable count: vowel groups, minus a silent trailing "e", at least one per word. Each digit adds one. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w) return 1;
  const digits = (w.match(/[0-9]/g) ?? []).length;
  const letters = w.replace(/[0-9]/g, "");
  let n = (letters.match(/[aeiouy]+/g) ?? []).length;
  if (n > 1 && letters.length > 2 && /[^aeiouy]e$/.test(letters) && !/le$/.test(letters)) n--;
  return Math.max(1, n + digits);
}

/** Relative time a word takes: a fixed cost to start it plus one unit per syllable, then the pause its punctuation adds. */
export function wordWeight(token: string): { speak: number; pause: number } {
  const speak = 0.45 + syllables(token);
  const pause = /[.!?…]["')\]]*$/.test(token) ? 2.2 : /[,;:—–-]["')\]]*$/.test(token) ? 1.0 : 0;
  return { speak, pause };
}

/** Start time in seconds of each whitespace-separated token in a clip `duration` seconds long. */
export function estimateWordStarts(tokens: string[], duration: number): number[] {
  if (!tokens.length || !(duration > 0)) return tokens.map(() => 0);
  const weights = tokens.map(wordWeight);
  const total = weights.reduce((s, w) => s + w.speak + w.pause, 0) - weights[weights.length - 1].pause;
  const lead = Math.min(LEAD_SILENCE, duration * 0.05);
  const tail = Math.min(TAIL_SILENCE, duration * 0.1);
  const scale = total > 0 ? Math.max(0, duration - lead - tail) / total : 0;
  const starts: number[] = [];
  let t = lead;
  for (const w of weights) {
    starts.push(Math.round(t * 1000) / 1000);
    t += (w.speak + w.pause) * scale;
  }
  return starts;
}

/* ---------- MP3 length ---------- */

// Bitrates in kbit/s by header index (1..14) for each MPEG version and layer.
const KBPS = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
// Sample rates by header index for MPEG-1 (version bits 3), MPEG-2 (2) and MPEG-2.5 (0).
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function frameAt(b: Uint8Array, i: number): { length: number; seconds: number } | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reserved
  const layer = (b[i + 1] >> 1) & 3; // 3 = I, 2 = II, 1 = III, 0 = reserved
  const bi = b[i + 2] >> 4;
  const si = (b[i + 2] >> 2) & 3;
  const padding = (b[i + 2] >> 1) & 1;
  if (version === 1 || layer === 0 || bi === 0 || bi === 15 || si === 3) return null;
  const mpeg1 = version === 3;
  const sampleRate = RATES[version][si];
  let bps: number;
  let samples: number;
  let length: number;
  if (layer === 3) {
    bps = (mpeg1 ? KBPS.v1l1 : KBPS.v2l1)[bi] * 1000;
    samples = 384;
    length = Math.floor((12 * bps) / sampleRate + padding) * 4;
  } else if (layer === 2) {
    bps = (mpeg1 ? KBPS.v1l2 : KBPS.v2l23)[bi] * 1000;
    samples = 1152;
    length = Math.floor((144 * bps) / sampleRate) + padding;
  } else {
    bps = (mpeg1 ? KBPS.v1l3 : KBPS.v2l23)[bi] * 1000;
    samples = mpeg1 ? 1152 : 576;
    length = Math.floor(((mpeg1 ? 144 : 72) * bps) / sampleRate) + padding;
  }
  if (length < 4) return null;
  return { length, seconds: samples / sampleRate };
}

/** Exact length of an MP3 in seconds from its frame headers (ID3v2 tag, CBR and VBR all handled), or null if no frames. */
export function mp3Duration(bytes: Uint8Array): number | null {
  let i = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    i = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  let seconds = 0;
  let frames = 0;
  while (i < bytes.length) {
    const f = frameAt(bytes, i);
    if (!f) {
      if (frames) break; // trailing junk such as an ID3v1 tag
      i++; // still looking for the first frame
      continue;
    }
    seconds += f.seconds;
    frames++;
    i += f.length;
  }
  return frames ? seconds : null;
}
