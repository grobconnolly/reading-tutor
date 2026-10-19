/* The two public Supabase values. Referenced literally so Next.js can inline them into the browser bundle. */

export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

export function publicSupabaseEnv(): PublicSupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export const SUPABASE_NOT_CONFIGURED =
  "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).";
