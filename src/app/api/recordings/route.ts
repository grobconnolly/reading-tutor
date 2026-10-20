import { NextResponse, type NextRequest } from "next/server";
import type { AzureDetail, RecordingRef } from "@/lib/azureAlign";
import { isUuid } from "@/lib/sessionSave";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

/**
 * The audio of a read, kept privately for 30 days so the parent can hear how a word was said.
 *
 *   POST /api/recordings?sessionId=&seconds=   body: the audio (audio/webm, audio/mp4, audio/ogg)  -> { ok, path }
 *   GET  /api/recordings?sessionId=            -> { url }: a signed link good for ten minutes
 *
 * The session must belong to the signed-in parent (checked through Row Level Security); the file then lives in the
 * private "reads" bucket under the parent's id, written and read with the service role. Older recordings of the same
 * parent are deleted on each upload. */

const BUCKET = "reads";
const KEEP_DAYS = 30;
const MAX_BYTES = 25 * 1024 * 1024;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" };

async function ownSession(sessionId: string) {
  const sb = await supabaseServer();
  const uid = await currentUserId(sb);
  if (!uid) return { uid: null, session: null };
  const { data, error } = await sb.from("sessions").select("id, azure_scores").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  return { uid, session: data as { id: string; azure_scores: AzureDetail | null } | null };
}

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
    if (!isUuid(sessionId)) return NextResponse.json({ error: "sessionId must be a uuid." }, { status: 400 });
    const { uid, session } = await ownSession(sessionId);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!session) return NextResponse.json({ error: "No such session." }, { status: 404 });

    const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXT[mime];
    if (!ext) return NextResponse.json({ error: "Unsupported audio type." }, { status: 415 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return NextResponse.json({ error: "No audio." }, { status: 400 });
    if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "Recording too large." }, { status: 413 });
    const secondsRaw = Number(req.nextUrl.searchParams.get("seconds"));
    const seconds = Number.isFinite(secondsRaw) && secondsRaw > 0 ? Math.round(secondsRaw * 10) / 10 : undefined;

    const admin = supabaseAdmin();
    const { error: bErr } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (bErr && !/already exists|duplicate/i.test(bErr.message)) throw new Error(bErr.message);

    const path = `${uid}/${sessionId}.${ext}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`Couldn't store the recording: ${upErr.message}`);

    const recording: RecordingRef = { path, mime, seconds };
    const detail: AzureDetail = session.azure_scores ?? { listener: "azure", scores: null, inserted: [], words: [] };
    const { error: uErr } = await admin.from("sessions").update({ azure_scores: { ...detail, recording } }).eq("id", sessionId);
    if (uErr) throw new Error(uErr.message);

    // Keep recordings for KEEP_DAYS; the parent page only ever needs recent ones.
    const { data: files } = await admin.storage.from(BUCKET).list(uid, { limit: 1000 });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const old = (files ?? []).filter((f) => f.created_at && Date.parse(f.created_at) < cutoff).map((f) => `${uid}/${f.name}`);
    if (old.length) await admin.storage.from(BUCKET).remove(old);

    return NextResponse.json({ ok: true, path });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save the recording.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
    if (!isUuid(sessionId)) return NextResponse.json({ error: "sessionId must be a uuid." }, { status: 400 });
    const { uid, session } = await ownSession(sessionId);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const path = session?.azure_scores?.recording?.path;
    if (!path || !path.startsWith(`${uid}/`)) return NextResponse.json({ error: "No recording for this session." }, { status: 404 });
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? "Couldn't sign the recording link.");
    return NextResponse.json({ url: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't fetch the recording.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
