import { NextResponse, type NextRequest } from "next/server";
import { speechTokenConfig } from "@/lib/speechToken";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

/**
 * POST /api/review   body: the read's audio (audio/webm, audio/mp4, audio/ogg, audio/wav)  -> { words: [{ w, t, d }] }
 *
 * The second listening pass. Azure's live assessment knows the story and leans toward it, so a word said wrong can
 * still come back as the story word with a passing score, and a word said right can score low. This route runs the
 * same audio through Azure's fast transcription with no story text at all, so the browser can set each word's final
 * status from both passes (see lib/review.ts). Takes a few seconds for a two-minute read. */

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"]);

interface FastWord { text?: string; offsetMilliseconds?: number; durationMilliseconds?: number }
interface FastResponse { phrases?: { words?: FastWord[] }[]; durationMilliseconds?: number; error?: { message?: string } }

export async function POST(req: NextRequest) {
  try {
    const sb = await supabaseServer();
    if (!(await currentUserId(sb))) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const cfg = speechTokenConfig();
    if (!cfg) return NextResponse.json({ error: "speech_not_configured" }, { status: 503 });

    const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(mime)) return NextResponse.json({ error: "Unsupported audio type." }, { status: 415 });
    const audio = await req.arrayBuffer();
    if (!audio.byteLength) return NextResponse.json({ error: "No audio." }, { status: 400 });
    if (audio.byteLength > MAX_BYTES) return NextResponse.json({ error: "Recording too large to review." }, { status: 413 });

    const form = new FormData();
    form.append("audio", new Blob([audio], { type: mime }), `read.${mime.split("/")[1]}`);
    form.append("definition", JSON.stringify({ locales: ["en-US"], profanityFilterMode: "None" }));
    const res = await fetch(`https://${cfg.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": cfg.key },
      body: form,
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error("[api/review] Azure", res.status, detail);
      return NextResponse.json({ error: `Azure review failed (${res.status}).` }, { status: res.status === 429 ? 503 : 502 });
    }
    const j = (await res.json()) as FastResponse;
    const words: { w: string; t: number; d: number }[] = [];
    for (const ph of j.phrases ?? []) {
      for (const w of ph.words ?? []) {
        if (typeof w.text !== "string" || !w.text) continue;
        words.push({ w: w.text, t: Math.round((w.offsetMilliseconds ?? 0)) / 1000, d: Math.round((w.durationMilliseconds ?? 0)) / 1000 });
      }
    }
    return NextResponse.json({ words, seconds: (j.durationMilliseconds ?? 0) / 1000 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't review the read.";
    console.error("[api/review]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
