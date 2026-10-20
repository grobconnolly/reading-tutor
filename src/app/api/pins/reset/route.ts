import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

/**
 * POST {} -> { ok: true }
 * "Forgot PIN?": clears the parent PIN and every reader PIN of the signed-in parent, so first-time setup runs
 * again and new ones are chosen. Signing in with the magic link already proves who the parent is, which is
 * why no PIN is needed here; nothing else (sessions, trouble words, rewards) is touched. The pin_set flags are
 * generated from the hashes, so nulling the hashes is the whole change.
 */
export async function POST() {
  try {
    const sb = await supabaseServer();
    const uid = await currentUserId(sb);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const admin = supabaseAdmin();
    const { error: pErr } = await admin.from("profiles").update({ parent_pin_hash: null }).eq("id", uid);
    if (pErr) throw new Error(pErr.message);
    const { error: rErr } = await admin.from("readers").update({ pin_hash: null }).eq("parent_id", uid);
    if (rErr) throw new Error(rErr.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't reset the PINs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
