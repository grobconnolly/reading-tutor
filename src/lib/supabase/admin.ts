import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "./env";

/**
 * Service-role client. Bypasses Row Level Security and column privileges, so it is used only
 * for the PIN hashes and the rate-limit table, always after the caller's ownership has been
 * checked with the cookie-bound client. The key never leaves the server ("server-only" above
 * makes the build fail if this file is imported from client code).
 */
export function supabaseAdmin(): SupabaseClient {
  const env = publicSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server only; see .env.example).");
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
