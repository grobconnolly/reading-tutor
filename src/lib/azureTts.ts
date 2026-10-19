/* Juno's cloud voice: Azure neural text-to-speech, called from the server only (milestone 4, spec section 4).
 *
 * Each line is synthesized once per (voice, rate, text) and kept in memory, so repeats like "That's right!" cost
 * nothing while the server instance is warm. The route also sends long Cache-Control headers so Vercel's CDN and the
 * browser keep GET responses; Supabase Storage can replace the in-memory map once milestone 2's client lands. */

import { createHash } from "node:crypto";
import { estimateWordStarts, mp3Duration } from "@/lib/ttsTiming";

if (typeof window !== "undefined") throw new Error("azureTts.ts is server-only: it reads AZURE_SPEECH_KEY.");

/** Bump when the SSML or output format changes so every cache (memory, CDN, browser) refills. */
export const TTS_VERSION = 1;
export const DEFAULT_VOICE = "en-US-AvaNeural";
export const DEFAULT_RATE = 0.95;
export const MAX_CHARS = 2000;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const AZURE_TIMEOUT_MS = 15000;

export interface TtsConfig {
  key: string;
  voice: string;
  endpoint: string;
}

/** The Azure settings, or null when the voice is not configured (the app then uses the device voice). */
export function ttsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig | null {
  const key = env.AZURE_SPEECH_KEY?.trim();
  const region = env.AZURE_SPEECH_REGION?.trim().toLowerCase().replace(/\s+/g, "");
  const endpoint = env.AZURE_TTS_ENDPOINT?.trim() || (region ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : "");
  if (!key || !endpoint) return null;
  return { key, voice: env.AZURE_TTS_VOICE?.trim() || DEFAULT_VOICE, endpoint };
}

export interface Clip {
  audio: Uint8Array<ArrayBuffer>;
  /** Length in seconds, measured from the MP3 frames. */
  duration: number;
  /** Start time of each whitespace-separated word, in seconds. */
  starts: number[];
  etag: string;
}

export class TtsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Collapse whitespace; null when there is nothing to say or it is too long. */
export function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_CHARS ? t : null;
}

/** Speaking rate as a multiplier of normal, clamped to what Azure honors and rounded for stable cache keys. */
export function normalizeRate(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
}

export function cacheKey(voice: string, rate: number, text: string): string {
  return createHash("sha256").update(`${TTS_VERSION}|${voice}|${rate}|${text}`).digest("hex");
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

export function buildSsml(voice: string, rate: number, text: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
    `<voice name="${escapeXml(voice)}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`
  );
}

/* ---------- in-memory cache (per server instance) ---------- */

const clips = new Map<string, Clip>();
const inflight = new Map<string, Promise<Clip>>();
let cacheBytes = 0;

function remember(key: string, clip: Clip): void {
  clips.set(key, clip);
  cacheBytes += clip.audio.byteLength;
  for (const [k, c] of clips) {
    if (cacheBytes <= MAX_CACHE_BYTES || k === key) break;
    clips.delete(k);
    cacheBytes -= c.audio.byteLength;
  }
}

function recall(key: string): Clip | undefined {
  const c = clips.get(key);
  if (c) {
    clips.delete(key); // move to the end: most recently used
    clips.set(key, c);
  }
  return c;
}

/** For tests. */
export function clearTtsCache(): void {
  clips.clear();
  inflight.clear();
  cacheBytes = 0;
}

/* ---------- synthesis ---------- */

async function synthesize(cfg: TtsConfig, rate: number, text: string, key: string): Promise<Clip> {
  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "ConnollyReadingCoach",
      },
      body: buildSsml(cfg.voice, rate, text),
      signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new TtsError(504, `Azure TTS unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new TtsError(res.status === 401 || res.status === 403 ? 502 : res.status === 429 ? 503 : 502, `Azure TTS ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const audio = new Uint8Array(await res.arrayBuffer());
  if (!audio.byteLength) throw new TtsError(502, "Azure TTS returned no audio");
  const duration = mp3Duration(audio) ?? (audio.byteLength * 8) / 48000;
  return { audio, duration, starts: estimateWordStarts(text.split(" "), duration), etag: `"${key.slice(0, 32)}"` };
}

/** The clip for a line, from memory when it has been said before. */
export async function speak(cfg: TtsConfig, text: string, rate: number): Promise<{ clip: Clip; cached: boolean }> {
  const key = cacheKey(cfg.voice, rate, text);
  const hit = recall(key);
  if (hit) return { clip: hit, cached: true };
  let p = inflight.get(key);
  if (!p) {
    p = synthesize(cfg, rate, text, key)
      .then((clip) => { remember(key, clip); return clip; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return { clip: await p, cached: false };
}
