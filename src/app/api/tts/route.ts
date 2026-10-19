/* POST /api/tts (spec section 4) and its GET twin.
 *
 *   GET  /api/tts                       -> { ok, voice, tag }: whether Juno's cloud voice is configured
 *   GET  /api/tts?text=…&rate=…&v=tag   -> MP3; cacheable by the CDN and the browser (the client uses this)
 *   POST /api/tts  { text, rate }       -> MP3; same audio, never cached beyond this server
 *
 * Audio responses carry X-Audio-Duration (seconds) and X-Word-Timings (start of each word, comma separated), which
 * "Hear it first" uses to highlight words. The Azure key stays in this process; the browser only ever sees audio. */

import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_RATE, normalizeRate, normalizeText, speak, TtsError, ttsConfig, TTS_VERSION, type TtsConfig } from "@/lib/azureTts";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const cfg = ttsConfig();
  if (!q.has("text")) {
    return NextResponse.json(cfg ? { ok: true, voice: cfg.voice, tag: `${cfg.voice}.${TTS_VERSION}` } : { ok: false }, { headers: NO_STORE });
  }
  return respond(cfg, q.get("text"), q.get("rate") ?? DEFAULT_RATE, true);
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; rate?: unknown } = {};
  try { body = (await req.json()) ?? {}; } catch { /* handled below as missing text */ }
  return respond(ttsConfig(), body.text, body.rate ?? DEFAULT_RATE, false);
}

async function respond(cfg: TtsConfig | null, rawText: unknown, rawRate: unknown, cacheable: boolean) {
  if (!cfg) return NextResponse.json({ error: "tts_not_configured" }, { status: 503, headers: NO_STORE });
  const text = normalizeText(rawText);
  if (!text) return NextResponse.json({ error: "text must be 1 to 2000 characters" }, { status: 400, headers: NO_STORE });
  const rate = normalizeRate(rawRate);
  try {
    const { clip, cached } = await speak(cfg, text, rate);
    return new NextResponse(clip.audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(clip.audio.byteLength),
        // A year on the CDN (purged by each deploy anyway) and a day in the browser; the URL's tag changes with the voice.
        "Cache-Control": cacheable ? "public, max-age=86400, s-maxage=31536000, immutable" : "private, no-store",
        ETag: clip.etag,
        "X-Audio-Duration": clip.duration.toFixed(3),
        "X-Word-Timings": clip.starts.join(","),
        "X-TTS-Cache": cached ? "hit" : "miss",
      },
    });
  } catch (e) {
    const status = e instanceof TtsError ? e.status : 502;
    const message = e instanceof Error ? e.message : "tts_failed";
    console.error("[api/tts]", message);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
