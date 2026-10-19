import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicSupabaseEnv, SUPABASE_NOT_CONFIGURED } from "./env";

/**
 * A Supabase client bound to the request's auth cookies. Runs as the signed-in parent, so Row Level
 * Security applies to everything it does. Create a new one per request; never share across requests.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const env = publicSupabaseEnv();
  if (!env) throw new Error(SUPABASE_NOT_CONFIGURED);
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* Server components can't set cookies; the proxy refreshes the session instead. */
        }
      },
    },
  });
}

/** The signed-in parent's user id, or null. */
export async function currentUserId(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
