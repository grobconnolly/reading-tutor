/* Thin wrappers over the browser's built-in speech APIs (milestone 1), and the switch that puts Azure in front of them
 * (milestone 3): getSR() hands out the Azure recognizer whenever a token is in hand, the browser's otherwise. */

import { type AzureSegment, wordAccuracy, type PracticeHeard } from "./azureAlign";
import { AzureSpeechRecognizer, azureLastError, azureReady, prepareAzure, touchAzure } from "./azureRecognizer";

export interface SRAlternative { transcript: string; confidence: number }
export interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
  /** Azure only: the segment's word scores (final results). */
  azure?: AzureSegment;
}
export interface SREvent { resultIndex: number; results: { length: number; [index: number]: SRResult } }
export interface SRErrorEvent { error: string }
export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Azure only: the text she is reading (or the practice word), scored against what she says. Ignored by the browser. */
  referenceText?: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SpeechRecognizer;

export type ListenEngine = "azure" | "browser";

function browserSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** The recognizer to use right now: Azure when a token and the SDK are ready, else the browser's own. */
export function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  touchAzure();
  if (azureReady()) return AzureSpeechRecognizer as unknown as SRCtor;
  return browserSR();
}

export function hasSR(): boolean {
  return !!getSR();
}

/** Which engine getSR() would hand out right now. */
export function listeningEngine(): ListenEngine | null {
  if (typeof window === "undefined") return null;
  if (azureReady()) return "azure";
  return browserSR() ? "browser" : null;
}

let announced: ListenEngine | null = null;

/**
 * Fetch an Azure token and load the SDK so the next start() can use them synchronously (Safari only opens the
 * microphone inside the tap that asked for it). Resolves with the engine that will listen. Safe to call often.
 */
export async function prepareListening(): Promise<ListenEngine | null> {
  if (typeof window === "undefined") return null;
  const ok = await prepareAzure();
  const engine: ListenEngine | null = ok ? "azure" : browserSR() ? "browser" : null;
  if (engine !== announced) {
    announced = engine;
    console.info(`[reading-coach] ${listeningStatus()}${engine !== "azure" && azureLastError() ? ` (Azure off: ${azureLastError()})` : ""}`);
  }
  return engine;
}

export function browserName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/CriOS|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "this browser";
}

/** One line for the coach bar or the mic badge: "Listening with Azure" or "Listening with Safari". */
export function listeningStatus(): string {
  const engine = listeningEngine();
  if (engine === "azure") return "Listening with Azure";
  if (engine === "browser") return `Listening with ${browserName()}`;
  return "Listening";
}

export function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis || null;
}

/* ---------- voice choice ---------- */

export const VOICE_KEY = "reading-coach.voice";

/** Warm, natural-sounding English voices, best first. Matched as substrings of the voice name. */
const PREFERRED = ["Ava", "Zoe", "Samantha", "Allison", "Nicky", "Susan", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Microsoft Michelle", "Microsoft Emma", "Microsoft Ana", "Karen", "Moira", "Tessa", "Serena"];

/** Apple's novelty and Eloquence voices: never pick these for a child. */
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

/** Higher is better. Premium and enhanced downloads, Edge's natural voices and Google's voice beat the compact defaults. */
export function voiceQuality(v: SpeechSynthesisVoice): number {
  const name = v.name;
  const uri = v.voiceURI.toLowerCase();
  if (!/^en/i.test(v.lang)) return -1000;
  if (NOVELTY.test(name)) return -500;
  let s = 0;
  if (/premium/.test(uri) || /premium/i.test(name)) s += 100;
  else if (/enhanced/.test(uri) || /enhanced/i.test(name)) s += 80;
  else if (/natural|neural|online/i.test(name)) s += 70;
  else if (/google/i.test(name)) s += 60;
  else if (/compact|eloquence/.test(uri)) s -= 30;
  const idx = PREFERRED.findIndex((p) => name.includes(p));
  if (idx >= 0) s += 50 - idx;
  if (/^en[-_]US/i.test(v.lang)) s += 10;
  return s;
}

export type VoiceTier = "natural" | "good" | "basic";

export function voiceTier(v: SpeechSynthesisVoice): VoiceTier {
  const q = voiceQuality(v);
  return q >= 70 ? "natural" : q >= 40 ? "good" : "basic";
}

/** Natural voices sound processed when pitched up, so keep them at 1.0. */
export function pitchFor(v: SpeechSynthesisVoice | null): number {
  return v && voiceTier(v) === "natural" ? 1.0 : 1.05;
}

/** English voices on this device, best first. */
export function listVoices(): SpeechSynthesisVoice[] {
  const synth = getSynth();
  if (!synth) return [];
  return synth.getVoices()
    .filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name))
    .sort((a, b) => voiceQuality(b) - voiceQuality(a) || a.name.localeCompare(b.name));
}

export function getSavedVoiceURI(): string | null {
  try { return window.localStorage.getItem(VOICE_KEY); } catch { return null; }
}

/** Remember a voice for this device, or null to go back to picking the best one automatically. */
export function saveVoiceURI(uri: string | null): void {
  try {
    if (uri) window.localStorage.setItem(VOICE_KEY, uri);
    else window.localStorage.removeItem(VOICE_KEY);
  } catch { /* ignore */ }
}

/** The saved voice if it is still installed, otherwise the best-sounding English voice. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const voices = listVoices();
  const saved = getSavedVoiceURI();
  if (saved) {
    const v = voices.find((x) => x.voiceURI === saved);
    if (v) return v;
  }
  return voices[0] ?? null;
}

/** "Ava (Premium) · en-US" */
export function voiceLabel(v: SpeechSynthesisVoice): string {
  const uri = v.voiceURI.toLowerCase();
  let name = v.name;
  if (!/premium|enhanced/i.test(name)) {
    if (/premium/.test(uri)) name += " (Premium)";
    else if (/enhanced/.test(uri)) name += " (Enhanced)";
  }
  return `${name} · ${v.lang}`;
}

export const MIC_BLOCKED_MSG = "I can't hear you. Ask a grown-up to allow the microphone for this page, then try again.";

export interface Listener {
  promise: Promise<string[]>;
  /** Stop listening now; the promise resolves with whatever was heard. */
  abort(): void;
}

export interface PracticeListener {
  promise: Promise<PracticeHeard>;
  /** Stop listening now; the promise resolves with whatever was heard. */
  abort(): void;
}

/**
 * Listen for one utterance of `word` (spec 6.2 step 2). With Azure this is a single-utterance Pronunciation Assessment
 * of that word and the result carries its accuracy score; with the browser only the transcripts come back.
 */
export function practiceWord(word: string, ms = 7000, onBlocked?: () => void): PracticeListener {
  const SR = getSR();
  if (!SR) return { promise: Promise.resolve({ alts: [], accuracy: null }), abort() {} };
  const r = new SR();
  r.lang = "en-US";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 5;
  if (word) r.referenceText = word;
  const got: string[] = [];
  let accuracy: number | null = null;
  let fin = false;
  let resolve: (v: PracticeHeard) => void = () => {};
  const promise = new Promise<PracticeHeard>((res) => { resolve = res; });
  const finish = () => { if (fin) return; fin = true; resolve({ alts: got, accuracy }); };
  r.onresult = (e) => {
    const first = e.results[0];
    for (let i = 0; i < first.length; i++) got.push(first[i].transcript);
    if (word && first.azure) accuracy = wordAccuracy(first.azure, word);
  };
  r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") onBlocked?.(); };
  r.onend = finish;
  try { r.start(); } catch { finish(); }
  const timer = setTimeout(() => { try { r.stop(); } catch { /* already stopped */ } }, ms);
  return {
    promise,
    abort() { clearTimeout(timer); try { r.abort(); } catch { /* ignore */ } finish(); },
  };
}

/** Listen for one utterance and return every alternative transcript heard. */
export function listenOnce(ms = 7000, onBlocked?: () => void): Listener {
  const l = practiceWord("", ms, onBlocked);
  return { promise: l.promise.then((h) => h.alts), abort: l.abort };
}
