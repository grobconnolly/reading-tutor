import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSpeechTokenCache, isSameSite, issueSpeechToken, SpeechTokenError, speechTokenConfig, TOKEN_LIFETIME_MS, TOKEN_REUSE_MS } from "../speechToken";

describe("speechTokenConfig", () => {
  it("needs both the key and the region, and builds the regional STS endpoint", () => {
    expect(speechTokenConfig({})).toBeNull();
    expect(speechTokenConfig({ AZURE_SPEECH_KEY: "k" })).toBeNull();
    expect(speechTokenConfig({ AZURE_SPEECH_REGION: "westus2" })).toBeNull();
    expect(speechTokenConfig({ AZURE_SPEECH_KEY: " k ", AZURE_SPEECH_REGION: " West US2 " })).toEqual({
      key: "k", region: "westus2", endpoint: "https://westus2.api.cognitive.microsoft.com/sts/v1.0/issueToken",
    });
  });
  it("accepts an endpoint override", () => {
    expect(speechTokenConfig({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "westus2", AZURE_SPEECH_TOKEN_ENDPOINT: "http://127.0.0.1:4546/sts" })?.endpoint).toBe("http://127.0.0.1:4546/sts");
  });
});

describe("isSameSite", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("trusts Sec-Fetch-Site when the browser sends it", () => {
    expect(isSameSite(h({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameSite(h({ "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isSameSite(h({ "sec-fetch-site": "cross-site", origin: "https://app.test", host: "app.test" }))).toBe(false);
    expect(isSameSite(h({ "sec-fetch-site": "none" }))).toBe(false);
  });
  it("otherwise compares Origin (or Referer) with the host the request arrived on", () => {
    expect(isSameSite(h({ origin: "https://reading-tutor-eta.vercel.app", host: "reading-tutor-eta.vercel.app" }))).toBe(true);
    expect(isSameSite(h({ referer: "https://reading-tutor-eta.vercel.app/", host: "reading-tutor-eta.vercel.app" }))).toBe(true);
    expect(isSameSite(h({ origin: "https://evil.example", host: "reading-tutor-eta.vercel.app" }))).toBe(false);
    expect(isSameSite(h({ origin: "https://app.test", host: "127.0.0.1:3000", "x-forwarded-host": "app.test" }))).toBe(true);
    expect(isSameSite(h({ origin: "not a url", host: "app.test" }))).toBe(false);
  });
  it("refuses a request with no origin at all (curl, scripts)", () => {
    expect(isSameSite(h({ host: "app.test" }))).toBe(false);
    expect(isSameSite(h({}))).toBe(false);
  });
});

describe("issueSpeechToken", () => {
  const cfg = { key: "secret-key", region: "westus2", endpoint: "https://westus2.api.cognitive.microsoft.com/sts/v1.0/issueToken" };
  let calls = 0;
  const fetchOk = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    expect(String(url)).toBe(cfg.endpoint);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe("secret-key");
    return new Response(`jwt-${calls}`, { status: 200 });
  }) as typeof fetch;

  beforeEach(() => { clearSpeechTokenCache(); calls = 0; });

  it("exchanges the key for a token and reports how long the browser may use it", async () => {
    const t = await issueSpeechToken(cfg, 1_000_000, fetchOk);
    expect(t).toEqual({ token: "jwt-1", region: "westus2", expiresInMs: TOKEN_LIFETIME_MS - 30000 });
    expect(calls).toBe(1);
  });
  it("hands the same token out while it is fresh, with a shrinking expiry, then fetches a new one", async () => {
    const t1 = await issueSpeechToken(cfg, 1_000_000, fetchOk);
    const t2 = await issueSpeechToken(cfg, 1_000_000 + 60_000, fetchOk);
    expect(t2.token).toBe(t1.token);
    expect(t2.expiresInMs).toBe(t1.expiresInMs - 60_000);
    expect(calls).toBe(1);
    const t3 = await issueSpeechToken(cfg, 1_000_000 + TOKEN_REUSE_MS, fetchOk);
    expect(t3.token).toBe("jwt-2");
    expect(calls).toBe(2);
  });
  it("shares one in-flight exchange between simultaneous callers", async () => {
    const slow = (async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return new Response("jwt-slow", { status: 200 }); }) as typeof fetch;
    const [a, b] = await Promise.all([issueSpeechToken(cfg, 0, slow), issueSpeechToken(cfg, 0, slow)]);
    expect(a.token).toBe("jwt-slow");
    expect(b.token).toBe("jwt-slow");
    expect(calls).toBe(1);
  });
  it("turns Azure refusals into route statuses that never leak the key", async () => {
    const deny = (async () => new Response("Access denied due to invalid subscription key", { status: 401 })) as typeof fetch;
    await expect(issueSpeechToken(cfg, 0, deny)).rejects.toMatchObject({ status: 502 });
    const busy = (async () => new Response("", { status: 429 })) as typeof fetch;
    await expect(issueSpeechToken(cfg, 0, busy)).rejects.toMatchObject({ status: 503 });
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const err = (await issueSpeechToken(cfg, 0, down).catch((e) => e as SpeechTokenError)) as SpeechTokenError;
    expect(err).toBeInstanceOf(SpeechTokenError);
    expect(err.status).toBe(504);
    expect(err.message).not.toContain("secret-key");
    const empty = (async () => new Response("  ", { status: 200 })) as typeof fetch;
    await expect(issueSpeechToken(cfg, 0, empty)).rejects.toMatchObject({ status: 502 });
  });
});
