/* Short-lived Azure Speech tokens for the browser SDK (milestone 3, spec section 4). Server only.
 *
 * The browser never sees AZURE_SPEECH_KEY: this module trades it for a token that Azure honors for 10 minutes, and the
 * route hands that token out. One token serves every reader on this server for a few minutes, so the exchange costs
 * one request to Azure every few minutes, not one per tap on "Start reading". */

if (typeof window !== "undefined") throw new Error("speechToken.ts is server-only: it reads AZURE_SPEECH_KEY.");

/** Azure: "Each access token is valid for 10 minutes." */
export const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
/** Hand the same token out for this long; a client therefore always gets one with at least 6 minutes left. */
export const TOKEN_REUSE_MS = 4 * 60 * 1000;
/** Reported expiry is shortened by this much so clients refresh before Azure actually rejects the token. */
const SAFETY_MS = 30 * 1000;
const AZURE_TIMEOUT_MS = 8000;

export interface SpeechTokenConfig {
  key: string;
  region: string;
  /** The STS endpoint that issues tokens, built from the region unless overridden. */
  endpoint: string;
}

/** The Azure settings, or null when listening through Azure is not configured (the browser recognizer is used then). */
export function speechTokenConfig(env: Record<string, string | undefined> = process.env): SpeechTokenConfig | null {
  const key = env.AZURE_SPEECH_KEY?.trim();
  const region = env.AZURE_SPEECH_REGION?.trim().toLowerCase().replace(/\s+/g, "");
  if (!key || !region) return null;
  const endpoint = env.AZURE_SPEECH_TOKEN_ENDPOINT?.trim() || `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  return { key, region, endpoint };
}

export interface IssuedToken {
  token: string;
  region: string;
  /** Milliseconds the client may rely on this token. */
  expiresInMs: number;
}

export class SpeechTokenError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Same-origin / same-site gate for routes that spend Azure quota. Modern browsers send Sec-Fetch-Site; older Safari
 * sends only Origin (or Referer), which is compared with the host the request arrived on. A request with neither
 * header (curl, another site) is refused. Milestone 2 adds the parent-session requirement on top of this.
 */
export function isSameSite(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "same-site";
  const from = headers.get("origin") ?? headers.get("referer");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!from || !host) return false;
  try {
    return new URL(from).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/* ---------- token cache (per server instance) ---------- */

let cached: { cfgKey: string; token: string; region: string; issuedAt: number } | null = null;
let inflight: Promise<IssuedToken> | null = null;

/** For tests. */
export function clearSpeechTokenCache(): void {
  cached = null;
  inflight = null;
}

async function exchange(cfg: SpeechTokenConfig, fetchFn: typeof fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(cfg.endpoint, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": cfg.key, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "0" },
      signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new SpeechTokenError(504, `Azure token service unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new SpeechTokenError(res.status === 401 || res.status === 403 ? 502 : res.status === 429 ? 503 : 502, `Azure token service ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const token = (await res.text()).trim();
  if (!token) throw new SpeechTokenError(502, "Azure token service returned no token");
  return token;
}

/** A token for the browser, reused across callers while it is fresh. */
export async function issueSpeechToken(cfg: SpeechTokenConfig, now: number = Date.now(), fetchFn: typeof fetch = fetch): Promise<IssuedToken> {
  const cfgKey = `${cfg.endpoint}|${cfg.key.slice(-4)}`;
  if (cached && cached.cfgKey === cfgKey && now - cached.issuedAt < TOKEN_REUSE_MS) {
    return { token: cached.token, region: cached.region, expiresInMs: TOKEN_LIFETIME_MS - (now - cached.issuedAt) - SAFETY_MS };
  }
  if (!inflight) {
    inflight = exchange(cfg, fetchFn)
      .then((token) => {
        cached = { cfgKey, token, region: cfg.region, issuedAt: now };
        return { token, region: cfg.region, expiresInMs: TOKEN_LIFETIME_MS - SAFETY_MS };
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
