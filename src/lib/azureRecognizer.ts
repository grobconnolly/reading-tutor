/* The Azure Speech SDK behind the browser SpeechRecognition shape (milestone 3, spec 6.1 step 3).
 *
 * ReadScreen and word practice only know the SpeechRecognizer interface in speech.ts. This class fills it with the SDK
 * in continuous mode plus Pronunciation Assessment against the story (referenceText), so swapping engines is a matter
 * of which constructor getSR() returns. The SDK (about a megabyte) is loaded on demand and only after the token route
 * has answered; while it is missing, or after it fails, the browser recognizer carries on exactly as in milestone 1. */

import { parseAzureJson, type AzureSegment } from "./azureAlign";
import type { SpeechRecognizer, SREvent, SRErrorEvent, SRResult } from "./speech";

type Sdk = typeof import("microsoft-cognitiveservices-speech-sdk");
type SdkRecognizer = import("microsoft-cognitiveservices-speech-sdk").SpeechRecognizer;
type SdkResult = import("microsoft-cognitiveservices-speech-sdk").SpeechRecognitionResult;

export interface SpeechToken {
  token: string;
  region: string;
  /** Epoch ms after which the token must not be used to start anything. */
  expiresAt: number;
}

const TOKEN_URL = "/api/speech-token";
const TOKEN_TIMEOUT_MS = 5000;
/** Refresh a running recognizer's token this long before it expires. */
const TOKEN_MARGIN_MS = 60000;
/** After the token route fails, ask again no sooner than this. */
const RETRY_AFTER_FAIL_MS = 60000;
/** After the SDK fails mid-session, listen with the browser for this long before trying Azure again. */
const COOL_OFF_MS = 120000;
const STOP_TIMEOUT_MS = 1500;
/** The SDK retries a refused connection a few times and then goes quiet without a canceled event (seen with a bad token),
 *  so a session that has not started within this long counts as failed and the browser recognizer takes over. */
const CONNECT_TIMEOUT_MS = 8000;
/** While the browser is still asking her to allow the microphone, give the session this long instead. */
const CONNECT_TIMEOUT_PROMPT_MS = 30000;

let sdkLoader: () => Promise<Sdk> = () => import("microsoft-cognitiveservices-speech-sdk");
let sdkPromise: Promise<Sdk> | null = null;
let sdk: Sdk | null = null;
let token: SpeechToken | null = null;
let tokenPromise: Promise<SpeechToken | null> | null = null;
let tokenFailedAt = 0;
let coolOffUntil = 0;
let settled = false;
let lastError = "";

const inBrowser = () => typeof window !== "undefined" || process.env.NODE_ENV === "test";

/** Tests: swap the SDK for a fake and clear every cache. */
export function _resetAzure(loader?: () => Promise<Sdk>): void {
  if (loader) sdkLoader = loader;
  sdkPromise = null;
  sdk = null;
  token = null;
  tokenPromise = null;
  tokenFailedAt = 0;
  coolOffUntil = 0;
  settled = false;
  lastError = "";
}

function loadSdk(): Promise<Sdk> {
  if (!sdkPromise) {
    sdkPromise = sdkLoader()
      .then((m) => { sdk = m; return m; })
      .catch((e) => { sdkPromise = null; lastError = `sdk: ${e instanceof Error ? e.message : String(e)}`; throw e; });
  }
  return sdkPromise;
}

/** A token from the server, cached until it nears expiry. Null when the route is off, failing, or recently failed. */
export function fetchSpeechToken(force = false): Promise<SpeechToken | null> {
  if (!inBrowser()) return Promise.resolve(null);
  const now = Date.now();
  if (!force && token && token.expiresAt - TOKEN_MARGIN_MS > now) return Promise.resolve(token);
  if (!force && tokenFailedAt && now - tokenFailedAt < RETRY_AFTER_FAIL_MS) return Promise.resolve(null);
  if (!tokenPromise) {
    tokenPromise = fetch(TOKEN_URL, { method: "POST", signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS), cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) { lastError = `token route ${r.status}`; return null; }
        const j = (await r.json()) as { token?: unknown; region?: unknown; expiresInMs?: unknown };
        if (typeof j.token !== "string" || typeof j.region !== "string" || !j.token || !j.region) { lastError = "token route: bad body"; return null; }
        const ttl = typeof j.expiresInMs === "number" && j.expiresInMs > 0 ? j.expiresInMs : 9 * 60 * 1000;
        return { token: j.token, region: j.region, expiresAt: Date.now() + ttl };
      })
      .catch((e) => { lastError = `token route: ${e instanceof Error ? e.message : String(e)}`; return null; })
      .then((t) => {
        tokenPromise = null;
        if (t) { token = t; tokenFailedAt = 0; } else { tokenFailedAt = Date.now(); }
        return t;
      });
  }
  return tokenPromise;
}

/** Load the SDK and a token. Resolves true when an Azure recognizer can be started right away. */
export async function prepareAzure(): Promise<boolean> {
  if (!inBrowser()) return false;
  if (coolOffUntil > Date.now()) { settled = true; return false; }
  const [m, t] = await Promise.all([loadSdk().catch(() => null), fetchSpeechToken()]);
  settled = true;
  return !!m && !!t;
}

/** Can `new AzureSpeechRecognizer().start()` work right now, without waiting on the network? */
export function azureReady(): boolean {
  return !!sdk && !!token && token.expiresAt > Date.now() && coolOffUntil <= Date.now();
}

/** Called whenever a recognizer is about to be chosen: quietly renew a token that is close to expiry, so a long
 *  session (help pauses restart the recognizer) does not drift onto the browser engine for want of a fresh token. */
export function touchAzure(): void {
  if (!inBrowser() || !sdk || !token || coolOffUntil > Date.now()) return;
  if (token.expiresAt - TOKEN_MARGIN_MS <= Date.now()) void fetchSpeechToken();
}

/** Has prepareAzure() answered at least once (so a caller need not wait for it)? */
export function azureSettled(): boolean {
  return settled;
}

/** Why Azure is not listening, for the console; empty when it is. */
export function azureLastError(): string {
  return lastError;
}

/** Stop offering Azure for a while; the browser recognizer takes over on the next start. */
export function noteAzureFailure(reason: string): void {
  lastError = reason;
  coolOffUntil = Date.now() + COOL_OFF_MS;
}

/** The browser API's error names, so ReadScreen's handling stays the same for both engines. */
export function mapAzureError(code: number | undefined, details: string | undefined, m: Sdk | null): string {
  const d = details ?? "";
  if (/NotAllowedError|PermissionDenied|Permission denied|not allowed|SecurityError/i.test(d)) return "not-allowed";
  if (/NotFoundError|NotReadableError|DevicesNotFoundError|OverconstrainedError|no (microphone|audio)|getUserMedia|AbortError/i.test(d)) return "audio-capture";
  if (m && code != null) {
    const C = m.CancellationErrorCode;
    if (code === C.AuthenticationFailure || code === C.Forbidden) return "azure-auth";
    if (code === C.ConnectionFailure || code === C.ServiceTimeout) return "azure-connection";
    if (code === C.TooManyRequests) return "azure-busy";
  }
  return "azure";
}

/** "granted", "prompt", "denied" or "unknown" (no Permissions API, as on older iPads). */
async function micPermission(): Promise<string> {
  try {
    const perms = (globalThis.navigator as Navigator | undefined)?.permissions;
    if (!perms) return "unknown";
    return (await perms.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

export class AzureSpeechRecognizer implements SpeechRecognizer {
  lang = "en-US";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  /** The story (or the practice word): Pronunciation Assessment scores what she says against it. */
  referenceText?: string;
  onresult: ((e: SREvent) => void) | null = null;
  onerror: ((e: SRErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;

  private rec: SdkRecognizer | null = null;
  private live = false;
  private done = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  start(): void {
    if (this.rec) throw new Error("InvalidStateError: recognition has already started");
    const m = sdk, t = token;
    if (!m || !t) throw new Error("Azure listening is not ready; call prepareAzure() first");
    const cfg = m.SpeechConfig.fromAuthorizationToken(t.token, t.region);
    cfg.speechRecognitionLanguage = this.lang || "en-US";
    const rec = new m.SpeechRecognizer(cfg, m.AudioConfig.fromDefaultMicrophoneInput());
    if (this.referenceText) {
      new m.PronunciationAssessmentConfig(this.referenceText, m.PronunciationAssessmentGradingSystem.HundredMark, m.PronunciationAssessmentGranularity.Word, true).applyTo(rec);
    }
    this.rec = rec;
    this.live = true;
    this.done = false;

    const handle = (r: SdkResult) => {
      this.sessionUp();
      if (!this.live || r.reason !== m.ResultReason.RecognizedSpeech || !r.text) return;
      const seg = parseAzureJson(r.properties?.getProperty(m.PropertyId.SpeechServiceResponse_JsonResult));
      const alts = seg?.alternatives.length ? seg.alternatives : [r.text];
      this.emit(true, alts.slice(0, Math.max(1, this.maxAlternatives)), seg);
    };
    rec.sessionStarted = () => this.sessionUp();
    rec.recognizing = (_s, e) => {
      this.sessionUp();
      if (!this.live || !this.interimResults) return;
      const text = e.result?.text;
      if (text) this.emit(false, [text], null);
    };
    rec.canceled = (_s, e) => {
      if (e.reason === m.CancellationReason.Error) this.fail(e.errorCode, e.errorDetails);
      this.finish();
    };
    rec.sessionStopped = () => this.finish();

    if (this.continuous) {
      rec.recognized = (_s, e) => handle(e.result);
      rec.startContinuousRecognitionAsync(() => {}, (err) => { this.fail(undefined, String(err)); this.finish(); });
      this.scheduleRefresh();
    } else {
      rec.recognizeOnceAsync((r) => { handle(r); this.finish(); }, (err) => { this.fail(undefined, String(err)); this.finish(); });
    }
    this.armWatchdog();
  }

  /** The service answered: the session is real, so the watchdog stands down. */
  private sessionUp(): void {
    this.connected = true;
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
  }

  private armWatchdog(): void {
    void micPermission().then((state) => {
      if (this.done || this.connected) return;
      const ms = state === "granted" ? CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_PROMPT_MS;
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        if (this.done || this.connected) return;
        this.fail(undefined, `no session within ${ms} ms`);
        this.live = false;
        this.shutdown(); // stop first, then close: closing mid-connect trips a null deferral inside the SDK
      }, ms);
    });
  }

  /** Stop listening; results already heard still arrive, then onend fires. */
  stop(): void {
    this.shutdown();
  }

  /** Stop listening and drop anything not yet delivered. */
  abort(): void {
    this.live = false;
    this.shutdown();
  }

  private shutdown(): void {
    const rec = this.rec;
    if (!rec || this.done) return;
    if (this.stopTimer) return;
    this.stopTimer = setTimeout(() => this.finish(), STOP_TIMEOUT_MS);
    if (this.continuous) rec.stopContinuousRecognitionAsync(() => this.finish(), () => this.finish());
    else this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.live = false;
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    const rec = this.rec;
    this.rec = null;
    try { rec?.close(); } catch { /* already closed */ }
    setTimeout(() => this.onend?.(), 0);
  }

  private fail(code: number | undefined, details: string | undefined): void {
    const error = mapAzureError(code, details, sdk);
    // A blocked or missing microphone would stop the browser recognizer too, so only Azure's own troubles trigger the fallback.
    if (error !== "not-allowed" && error !== "audio-capture") noteAzureFailure(`${error}: ${details ?? ""}`.trim());
    this.onerror?.({ error });
  }

  private emit(isFinal: boolean, alts: string[], azure: AzureSegment | null): void {
    const r: SRResult = { isFinal, length: alts.length };
    alts.forEach((transcript, i) => { r[i] = { transcript, confidence: isFinal ? 1 : 0 }; });
    if (azure) r.azure = azure;
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: r } });
  }

  private scheduleRefresh(): void {
    if (!token) return;
    const wait = Math.max(10000, token.expiresAt - TOKEN_MARGIN_MS - Date.now());
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void fetchSpeechToken(true).then((t) => {
        if (!t || !this.rec || this.done) return;
        this.rec.authorizationToken = t.token;
        this.scheduleRefresh();
      });
    }, wait);
  }
}
