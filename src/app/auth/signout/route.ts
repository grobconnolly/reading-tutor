import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Signs the parent out of Supabase on this device and returns to the login page. */
export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
