import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

/**
 * Runs before every page and API route: refreshes the Supabase session cookie and sends anyone who
 * isn't a signed-in parent to /login (API routes get a 401 instead). Readers never sign in themselves;
 * they use a device where the parent is signed in.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = publicSupabaseEnv();
  if (!env) {
    // Not configured yet: the login page explains what to set.
    if (isPublic(pathname)) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const sb = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await sb.auth.getUser();
  const user = data.user;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!user) {
    if (isPublic(pathname)) return response;
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    return redirectTo("/login");
  }
  if (pathname === "/login") return redirectTo("/");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
