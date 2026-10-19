import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { isUuid } from "@/lib/sessionSave";
import { isValidPin } from "@/lib/store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

const COST = 10;

interface Body {
  parentPin?: string;
  readers?: { id: string; pin: string }[];
}

/**
 * POST { parentPin?, readers?: [{ id, pin }] } -> { ok: true }
 * Hashes and stores PINs. Rules, as in version 1: 4 digits, the parent PIN differs from every reader PIN,
 * and each reader has her own. Hashes are written with the service role after ownership is checked
 * through Row Level Security, because the browser can neither read nor write the hash columns.
 */
export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const uid = await currentUserId(sb);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const raw = (await req.json().catch(() => null)) as Body | null;
    const parentPin = typeof raw?.parentPin === "string" ? raw.parentPin : undefined;
    const readerPins = Array.isArray(raw?.readers) ? raw.readers : [];
    if (parentPin !== undefined && !isValidPin(parentPin)) return NextResponse.json({ error: "The parent PIN needs to be 4 digits." }, { status: 400 });
    for (const r of readerPins) {
      if (!r || !isUuid(r.id) || typeof r.pin !== "string") return NextResponse.json({ error: "Bad reader PIN entry." }, { status: 400 });
    }
    if (parentPin === undefined && !readerPins.length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

    // Only this parent's readers (RLS filters the rest out).
    const { data: own, error: ownErr } = await sb.from("readers").select("id, name").eq("parent_id", uid);
    if (ownErr) throw new Error(ownErr.message);
    const names = new Map<string, string>((own ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));
    for (const r of readerPins) {
      if (!names.has(r.id)) return NextResponse.json({ error: "No such reader." }, { status: 404 });
      if (!isValidPin(r.pin)) return NextResponse.json({ error: `${names.get(r.id)}'s PIN needs to be 4 digits.` }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: prof, error: pErr } = await admin.from("profiles").select("parent_pin_hash").eq("id", uid).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const { data: rows, error: rErr } = await admin.from("readers").select("id, pin_hash").eq("parent_id", uid);
    if (rErr) throw new Error(rErr.message);
    const existing = new Map<string, string | null>((rows ?? []).map((r: { id: string; pin_hash: string | null }) => [r.id, r.pin_hash ?? null]));

    // The PINs each person will have after this change: plaintext when new, else the stored hash.
    type Known = { plain?: string; hash?: string | null };
    const parentAfter: Known = parentPin !== undefined ? { plain: parentPin } : { hash: (prof?.parent_pin_hash as string | null) ?? null };
    const readersAfter = new Map<string, Known>();
    for (const id of names.keys()) {
      const fresh = readerPins.find((r) => r.id === id);
      readersAfter.set(id, fresh ? { plain: fresh.pin } : { hash: existing.get(id) ?? null });
    }
    const same = async (a: Known, b: Known): Promise<boolean> => {
      if (a.plain != null && b.plain != null) return a.plain === b.plain;
      if (a.plain != null && b.hash) return bcrypt.compare(a.plain, b.hash);
      if (b.plain != null && a.hash) return bcrypt.compare(b.plain, a.hash);
      return false; // both stored or both unset: nothing new to compare, and stored ones were checked when set
    };
    for (const [id, k] of readersAfter) {
      if (k.plain == null && parentAfter.plain == null) continue;
      if (await same(k, parentAfter)) return NextResponse.json({ error: "Use a different PIN for the parent." }, { status: 400 });
      for (const [id2, k2] of readersAfter) {
        if (id2 <= id) continue;
        if (k.plain == null && k2.plain == null) continue;
        if (await same(k, k2)) return NextResponse.json({ error: "Give each reader her own PIN." }, { status: 400 });
      }
    }

    if (parentPin !== undefined) {
      const parent_pin_hash = await bcrypt.hash(parentPin, COST);
      const { error } = await admin.from("profiles").upsert({ id: uid, parent_pin_hash }, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    for (const r of readerPins) {
      const pin_hash = await bcrypt.hash(r.pin, COST);
      const { error } = await admin.from("readers").update({ pin_hash }).eq("id", r.id).eq("parent_id", uid);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save the PIN.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
