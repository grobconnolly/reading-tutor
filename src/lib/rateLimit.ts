/* Fixed-size sliding window rate limiting. The pure part is unit-tested; the storage part lives in pin_attempts. */

import type { SupabaseClient } from "@supabase/supabase-js";

export const PIN_RATE = { max: 5, windowMs: 60_000 } as const;

export interface RateDecision {
  ok: boolean;
  /** Seconds until the oldest counted attempt leaves the window (0 when allowed). */
  retryAfterSec: number;
}

/** Given the timestamps (ms) of earlier attempts, may one more happen at `now`? */
export function allowAttempt(earlier: number[], now: number, max = PIN_RATE.max, windowMs = PIN_RATE.windowMs): RateDecision {
  const inWindow = earlier.filter((t) => t > now - windowMs && t <= now).sort((a, b) => a - b);
  if (inWindow.length < max) return { ok: true, retryAfterSec: 0 };
  const oldest = inWindow[inWindow.length - max];
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
}

/**
 * Record an attempt for `key` and say whether it is allowed. Rejected attempts are not recorded,
 * so a locked-out caller gets back in once the earlier tries age out. Uses the service-role
 * client because pin_attempts has no policies for anyone else.
 */
export async function takePinAttempt(admin: SupabaseClient, key: string, now: Date = new Date()): Promise<RateDecision> {
  const since = new Date(now.getTime() - PIN_RATE.windowMs).toISOString();
  const { data, error } = await admin.from("pin_attempts").select("attempted_at").eq("key", key).gte("attempted_at", since);
  if (error) throw new Error(`rate limit read failed: ${error.message}`);
  const decision = allowAttempt((data ?? []).map((r) => new Date(r.attempted_at as string).getTime()), now.getTime());
  if (!decision.ok) return decision;
  const { error: insErr } = await admin.from("pin_attempts").insert({ key, attempted_at: now.toISOString() });
  if (insErr) throw new Error(`rate limit write failed: ${insErr.message}`);
  // Keep the table small. Best effort.
  const old = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  await admin.from("pin_attempts").delete().lt("attempted_at", old);
  return decision;
}
