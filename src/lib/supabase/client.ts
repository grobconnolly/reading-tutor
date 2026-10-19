"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseEnv, SUPABASE_NOT_CONFIGURED } from "./env";

let client: SupabaseClient | null = null;

/** The browser client. Uses only the two public values; the session lives in cookies set by the server. */
export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  const env = publicSupabaseEnv();
  if (!env) throw new Error(SUPABASE_NOT_CONFIGURED);
  client = createBrowserClient(env.url, env.anonKey);
  return client;
}
