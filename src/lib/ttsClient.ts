/* Browser side of Juno's cloud voice: asks /api/tts whether it is configured, fetches each line as MP3 (keeping the
 * blobs so repeats are instant), and owns the one <audio> element that plays them. iOS Safari lets a page play audio
 * only from a user tap, so that element is "unlocked" by playing a sliver of silence on the first tap anywhere;
 * after that the same element may start any later line, even one that arrives after a fetch. */

export interface CloudVoice {
  voice: string;
  /** Changes when the voice or the server's SSML version changes; part of every audio URL so caches refill. */
  tag: string;
}

export interface Line {
  /** Object URL of the MP3 blob. */
  url: string;
  duration: number;
  /** Start time of each whitespace-separated word, or null when the server sent none. */
  starts: number[] | null;
}

const PROBE_TIMEOUT_MS = 3000;
const LINE_TIMEOUT_MS = 8000;
const START_TIMEOUT_MS = 5000;
const MAX_LINES = 80;
const RETRY_PROBE_MS = 60000;
const COOL_OFF_AFTER = 2;
const COOL_OFF_MS = 60000;

/* ---------- is the cloud voice on? ---------- */

let probe: Promise<CloudVoice | null> | null = null;
let probeFailedAt = 0;
let failures = 0;
let coolOffUntil = 0;

/** Resolves with the cloud voice when the server has one configured, else null. Asked once, re-asked after a network error. */
export function cloudVoice(): Promise<CloudVoice | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (coolOffUntil > Date.now()) return Promise.resolve(null);
  if (!probe || (probeFailedAt && Date.now() - probeFailedAt > RETRY_PROBE_MS)) {
    probeFailedAt = 0;
    probe = fetch("/api/tts", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = (await r.json()) as { ok?: boolean; voice?: string; tag?: string };
        return j.ok && j.voice && j.tag ? { voice: j.voice, tag: j.tag } : null;
      })
      .catch(() => { probeFailedAt = Date.now(); return null; });
  }
  return probe;
}

/** After repeated failures, stop trying the cloud voice for a minute so Juno does not lag before every line. */
export function noteLineFailure(): void {
  failures++;
  if (failures >= COOL_OFF_AFTER) { coolOffUntil = Date.now() + COOL_OFF_MS; failures = 0; }
}
export function noteLineSuccess(): void { failures = 0; }

/* ---------- the shared audio element ---------- */

let audio: HTMLAudioElement | null = null;
let unlocked = false;

export function sharedAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

export function audioUnlocked(): boolean { return unlocked; }

/** 0.1 s of 8 kHz silence as a WAV data URL, built here so no opaque base64 blob lives in the source. */
function silenceUrl(): string {
  const samples = 800;
  const b = new Uint8Array(44 + samples);
  const dv = new DataView(b.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + samples, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  str(36, "data"); dv.setUint32(40, samples, true);
  b.fill(128, 44);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let unlockInstalled = false;

/** Call once on the client. The first tap or key press plays silence through the shared element, which is what iOS
 *  needs before later lines may start without a tap of their own. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof document === "undefined") return;
  unlockInstalled = true;
  const events: (keyof DocumentEventMap)[] = ["touchend", "click", "keydown"];
  const silence = silenceUrl();
  const unlock = () => {
    if (unlocked) return;
    const el = sharedAudio();
    el.src = silence;
    const p = el.play();
    if (!p) { unlocked = true; done(); return; }
    p.then(() => {
      unlocked = true;
      if (el.src === silence) el.pause(); // never pause a real line that started in the meantime
      done();
    }).catch(() => { /* not a real gesture yet; try again on the next one */ });
  };
  const done = () => events.forEach((e) => document.removeEventListener(e, unlock, true));
  events.forEach((e) => document.addEventListener(e, unlock, { capture: true, passive: true }));
}

/* ---------- fetching lines ---------- */

const lines = new Map<string, Promise<Line>>();

export function lineKey(text: string, rate: number): string { return `${rate}|${text}`; }

/** The MP3 for a line, from the in-page cache when it has been said before. Rejects when the server cannot provide it. */
export function fetchLine(cv: CloudVoice, text: string, rate: number): Promise<Line> {
  const key = lineKey(text, rate);
  let p = lines.get(key);
  if (p) return p;
  const params = new URLSearchParams({ text, rate: String(rate), v: cv.tag });
  p = fetch(`/api/tts?${params}`, { signal: AbortSignal.timeout(LINE_TIMEOUT_MS) }).then(async (r) => {
    if (!r.ok || !/audio/.test(r.headers.get("content-type") ?? "")) throw new Error(`tts ${r.status}`);
    const blob = await r.blob();
    const starts = (r.headers.get("x-word-timings") ?? "").split(",").map(Number).filter((n) => Number.isFinite(n));
    const duration = Number(r.headers.get("x-audio-duration")) || 0;
    return { url: URL.createObjectURL(blob), duration, starts: starts.length ? starts : null };
  });
  lines.set(key, p);
  p.then(() => trimLines(), () => lines.delete(key));
  return p;
}

function trimLines(): void {
  while (lines.size > MAX_LINES) {
    const [k, p] = lines.entries().next().value as [string, Promise<Line>];
    lines.delete(k);
    p.then((l) => URL.revokeObjectURL(l.url)).catch(() => {});
  }
}

/* ---------- playback ---------- */

export interface PlayHooks {
  onstart?: () => void;
  /** Fires as each word begins, from the line's timings. */
  onword?: (index: number) => void;
}

/** Play a line through the shared element. Resolves when it ends or is paused by someone else (cancel, next line);
 *  rejects if playback never starts, so the caller can fall back to the device voice. */
export function playLine(line: Line, hooks: PlayHooks = {}): { started: Promise<void>; finished: Promise<void> } {
  const el = sharedAudio();
  let settleStart!: () => void;
  let failStart!: (e: unknown) => void;
  let settleEnd!: () => void;
  const started = new Promise<void>((res, rej) => { settleStart = res; failStart = rej; });
  const finished = new Promise<void>((res) => { settleEnd = res; });
  started.catch(() => {});

  let begun = false;
  let over = false;
  let raf = 0;
  let last = -1;
  let safety = 0;
  const starts = line.starts;
  const fail = (e: unknown) => { cleanup(); over = true; failStart(e); settleEnd(); };

  const tick = () => {
    if (over) return;
    if (starts && hooks.onword) {
      const t = el.currentTime + 0.05;
      let i = last;
      while (i + 1 < starts.length && starts[i + 1] <= t) i++;
      if (i !== last && i >= 0) { last = i; hooks.onword(i); }
    }
    raf = requestAnimationFrame(tick);
  };
  const cleanup = () => {
    el.removeEventListener("playing", onPlaying);
    el.removeEventListener("pause", onStop);
    el.removeEventListener("ended", onStop);
    el.removeEventListener("error", onError);
    if (raf) cancelAnimationFrame(raf);
    if (safety) window.clearTimeout(safety);
    window.clearTimeout(startTimer);
  };
  const end = () => {
    if (over) return;
    over = true;
    cleanup();
    settleEnd();
  };
  const onPlaying = () => {
    if (begun) return;
    begun = true;
    settleStart();
    hooks.onstart?.();
    tick();
    safety = window.setTimeout(end, (line.duration || 10) * 1000 + 2500);
  };
  const onStop = () => { if (begun) end(); };
  const onError = () => { if (begun) end(); else fail(new Error("audio error")); };
  // If the clip has not started within a few seconds the caller falls back to the device voice.
  const startTimer = window.setTimeout(() => { if (!begun && !over) fail(new Error("audio did not start")); }, START_TIMEOUT_MS);
  el.addEventListener("playing", onPlaying);
  el.addEventListener("pause", onStop);
  el.addEventListener("ended", onStop);
  el.addEventListener("error", onError);

  el.src = line.url;
  const p = el.play();
  if (p) p.catch((e) => { if (!begun && !over) fail(e); });
  return { started, finished };
}

/** Stop whatever the shared element is playing. */
export function stopAudio(): void {
  if (audio && !audio.paused) audio.pause();
}
