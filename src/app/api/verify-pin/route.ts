import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { takePinAttempt } from "@/lib/rateLimit";
import { isUuid } from "@/lib/sessionSave";
import { isValidPin } from "@/lib/store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

/**
 * POST { target: readerId | "parent", pin } -> { ok } | { ok: false, reason: "not-set" }
 * Checks the PIN against its bcrypt hash. 5 tries per minute per target per parent account.
 */
export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const uid = await currentUserId(sb);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { target?: unknown; pin?: unknown } | null;
    const target = typeof body?.target === "string" ? body.target : "";
    const pin = typeof body?.pin === "string" ? body.pin : "";
    if ((target !== "parent" && !isUuid(target)) || !isValidPin(pin)) {
      return NextResponse.json({ error: "Send a target and a 4-digit PIN." }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const rate = await takePinAttempt(admin, `${uid}:${target}`);
    if (!rate.ok) {
      return NextResponse.json(
        { error: `Too many tries. Wait ${rate.retryAfterSec} seconds.`, retryAfterSec: rate.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    let hash: string | null = null;
    if (target === "parent") {
      const { data, error } = await admin.from("profiles").select("parent_pin_hash").eq("id", uid).maybeSingle();
      if (error) throw new Error(error.message);
      hash = (data?.parent_pin_hash as string | null) ?? null;
    } else {
      // Row Level Security: this query only finds readers that belong to the signed-in parent.
      const { data: own, error: ownErr } = await sb.from("readers").select("id").eq("id", target).maybeSingle();
      if (ownErr) throw new Error(ownErr.message);
      if (!own) return NextResponse.json({ error: "No such reader." }, { status: 404 });
      const { data, error } = await admin.from("readers").select("pin_hash").eq("id", target).maybeSingle();
      if (error) throw new Error(error.message);
      hash = (data?.pin_hash as string | null) ?? null;
    }

    if (!hash) return NextResponse.json({ ok: false, reason: "not-set" });
    const ok = await bcrypt.compare(pin, hash);
    return NextResponse.json({ ok });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PIN check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
