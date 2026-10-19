/* POST /api/speech-token (spec section 4): a short-lived Azure Speech token for the browser SDK.
 *
 *   GET  /api/speech-token   -> { ok }: whether listening through Azure is configured on this server
 *   POST /api/speech-token   -> { token, region, expiresInMs }, or 503 speech_not_configured, or 403 off-site
 *
 * Only same-site pages may ask (see isSameSite); milestone 2 adds the signed-in-parent requirement the spec asks for.
 * Responses are never cached: a token is a bearer credential for a few minutes of Azure time. */

import { NextResponse, type NextRequest } from "next/server";
import { isSameSite, issueSpeechToken, SpeechTokenError, speechTokenConfig } from "@/lib/speechToken";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json({ ok: !!speechTokenConfig() }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!isSameSite(req.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const cfg = speechTokenConfig();
  if (!cfg) return NextResponse.json({ error: "speech_not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const issued = await issueSpeechToken(cfg);
    return NextResponse.json(issued, { headers: NO_STORE });
  } catch (e) {
    const status = e instanceof SpeechTokenError ? e.status : 502;
    const message = e instanceof Error ? e.message : "token_failed";
    console.error("[api/speech-token]", message);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
