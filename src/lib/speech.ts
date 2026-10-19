/* Thin wrappers over the browser's built-in speech APIs (milestone 1). Azure replaces these later. */

export interface SRAlternative { transcript: string; confidence: number }
export interface SRResult { isFinal: boolean; length: number; [index: number]: SRAlternative }
export interface SREvent { resultIndex: number; results: { length: number; [index: number]: SRResult } }
export interface SRErrorEvent { error: string }
export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SpeechRecognizer;

export function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function hasSR(): boolean {
  return !!getSR();
}

export function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis || null;
}

const PREFERRED = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Ava", "Allison", "Karen", "Moira", "Zoe"];

/** A warm English voice if the device has one. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const synth = getSynth();
  if (!synth) return null;
  const vs = synth.getVoices();
  for (const p of PREFERRED) {
    const v = vs.find((v) => v.name.includes(p) && /^en/i.test(v.lang));
    if (v) return v;
  }
  return vs.find((v) => /^en-US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

export const MIC_BLOCKED_MSG = "I can't hear you. Ask a grown-up to allow the microphone for this page, then try again.";

export interface Listener {
  promise: Promise<string[]>;
  /** Stop listening now; the promise resolves with whatever was heard. */
  abort(): void;
}

/** Listen for one utterance and return every alternative transcript heard. */
export function listenOnce(ms = 7000, onBlocked?: () => void): Listener {
  const SR = getSR();
  if (!SR) return { promise: Promise.resolve([]), abort() {} };
  const r = new SR();
  r.lang = "en-US";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 5;
  const got: string[] = [];
  let fin = false;
  let resolve: (v: string[]) => void = () => {};
  const promise = new Promise<string[]>((res) => { resolve = res; });
  const finish = () => { if (fin) return; fin = true; resolve(got); };
  r.onresult = (e) => {
    const first = e.results[0];
    for (let i = 0; i < first.length; i++) got.push(first[i].transcript);
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
