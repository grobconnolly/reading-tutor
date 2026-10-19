import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Only same-site paths, so the link can't bounce the parent somewhere else. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

function siteOrigin(request: NextRequest): string {
  const { origin } = new URL(request.url);
  if (process.env.NODE_ENV === "development") return origin;
  const forwarded = request.headers.get("x-forwarded-host");
  return forwarded ? `https://${forwarded}` : origin;
}

/**
 * Where the magic link lands. Handles both link styles Supabase can send:
 *   ?code=...                 (PKCE, the default email template; must be opened in the browser that asked)
 *   ?token_hash=...&type=...  (if the email template is changed to use {{ .TokenHash }}; works from any device)
 * On success the session cookies are set and the parent lands on the reader screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = siteOrigin(request);
  const next = safeNext(searchParams.get("next"));
  const fail = (why: string) => NextResponse.redirect(`${origin}/login?error=${why}`);

  if (searchParams.get("error")) {
    const code = searchParams.get("error_code") ?? "";
    return fail(code.includes("expired") ? "expired" : "link");
  }

  const sb = await supabaseServer();
  const code = searchParams.get("code");
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    return error ? fail("link") : NextResponse.redirect(`${origin}${next}`);
  }
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    return error ? fail(error.message.toLowerCase().includes("expired") ? "expired" : "link") : NextResponse.redirect(`${origin}${next}`);
  }
  return fail("link");
}
