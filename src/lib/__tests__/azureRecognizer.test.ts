import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAzure, AzureSpeechRecognizer, azureReady, fetchSpeechToken, mapAzureError, prepareAzure } from "../azureRecognizer";
import { getSR, listeningEngine, listeningStatus, practiceWord, type SREvent } from "../speech";

/* ---------- a fake Speech SDK with just the surface the recognizer touches ---------- */

type Handler = (sender: unknown, e: unknown) => void;

class FakeRec {
  static instances: FakeRec[] = [];
  recognizing: Handler | null = null;
  recognized: Handler | null = null;
  canceled: Handler | null = null;
  sessionStarted: Handler | null = null;
  sessionStopped: Handler | null = null;
  authorizationToken = "";
  pa: FakePA | null = null;
  started = false;
  stopped = false;
  closed = false;
  onceCb: ((r: unknown) => void) | null = null;
  constructor(public cfg: { token: string; region: string; speechRecognitionLanguage: string }, public audio: unknown) {
    FakeRec.instances.push(this);
  }
  startContinuousRecognitionAsync(ok?: () => void) { this.started = true; ok?.(); }
  stopContinuousRecognitionAsync(ok?: () => void) { this.stopped = true; ok?.(); }
  recognizeOnceAsync(cb: (r: unknown) => void) { this.started = true; this.onceCb = cb; }
  close() { this.closed = true; }
}

class FakePA {
  constructor(public referenceText: string, public grading: number, public granularity: number, public miscue: boolean) {}
  applyTo(rec: FakeRec) { rec.pa = this; }
}

const fakeSdk = {
  SpeechConfig: { fromAuthorizationToken: (token: string, region: string) => ({ token, region, speechRecognitionLanguage: "" }) },
  AudioConfig: { fromDefaultMicrophoneInput: () => ({ mic: "default" }) },
  PronunciationAssessmentConfig: FakePA,
  PronunciationAssessmentGradingSystem: { FivePoint: 1, HundredMark: 2 },
  PronunciationAssessmentGranularity: { Phoneme: 1, Word: 2, FullText: 3 },
  ResultReason: { NoMatch: 0, Canceled: 1, RecognizingSpeech: 2, RecognizedSpeech: 3 },
  CancellationReason: { Error: 0, EndOfStream: 1 },
  CancellationErrorCode: { NoError: 0, AuthenticationFailure: 1, BadRequestParameters: 2, TooManyRequests: 3, ConnectionFailure: 4, ServiceTimeout: 5, ServiceError: 6, RuntimeError: 7, Forbidden: 8 },
  PropertyId: { SpeechServiceResponse_JsonResult: 23 },
  SpeechRecognizer: FakeRec,
};
type Sdk = typeof import("microsoft-cognitiveservices-speech-sdk");

function result(text: string, words: [string, string, number][], reason = 3) {
  const json = JSON.stringify({
    RecognitionStatus: "Success", Duration: 20000000,
    NBest: [{ Display: text, Lexical: text.toLowerCase(), PronunciationAssessment: { AccuracyScore: 90, FluencyScore: 85, CompletenessScore: 100, PronScore: 88 },
      Words: words.map(([Word, ErrorType, AccuracyScore], i) => ({ Word, Offset: i * 4000000, Duration: 3000000, PronunciationAssessment: { AccuracyScore, ErrorType } })) }],
  });
  return { reason, text, properties: { getProperty: (id: number) => (id === 23 ? json : "") } };
}

const tokenResponse = (expiresInMs = 540000) => new Response(JSON.stringify({ token: "tok-1", region: "westus2", expiresInMs }), { status: 200 });
const tick = () => new Promise((r) => setTimeout(r, 1));

beforeEach(() => {
  FakeRec.instances = [];
  _resetAzure(() => Promise.resolve(fakeSdk as unknown as Sdk));
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Version/17 Safari/605" });
  vi.stubGlobal("fetch", vi.fn(async () => tokenResponse()));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token and readiness", () => {
  it("is not ready until prepared, then ready, and getSR() hands out the Azure recognizer", async () => {
    expect(azureReady()).toBe(false);
    expect(getSR()).toBeNull(); // no browser recognizer in this fake window either
    expect(await prepareAzure()).toBe(true);
    expect(azureReady()).toBe(true);
    expect(getSR()).toBe(AzureSpeechRecognizer);
    expect(listeningEngine()).toBe("azure");
    expect(listeningStatus()).toBe("Listening with Azure");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/speech-token");
  });
  it("reuses a fresh token instead of asking the route again", async () => {
    await prepareAzure();
    await prepareAzure();
    expect(await fetchSpeechToken()).toMatchObject({ token: "tok-1", region: "westus2" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("renews a token that is about to expire when a recognizer is next chosen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse(60050))); // 50 ms outside the 60 s renewal margin
    await prepareAzure();
    expect(getSR()).toBe(AzureSpeechRecognizer);
    expect(fetch).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 100));
    getSR(); // now inside the margin
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("falls back to the browser when the route says Azure is not configured, and does not hammer the route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "speech_not_configured" }), { status: 503 })));
    (globalThis as unknown as { window: Record<string, unknown> }).window.webkitSpeechRecognition = class {};
    expect(await prepareAzure()).toBe(false);
    expect(await prepareAzure()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(azureReady()).toBe(false);
    expect(listeningEngine()).toBe("browser");
    expect(listeningStatus()).toBe("Listening with Safari");
  });
  it("falls back when the route is unreachable or the SDK will not load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await prepareAzure()).toBe(false);
    _resetAzure(() => Promise.reject(new Error("chunk failed")));
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse()));
    expect(await prepareAzure()).toBe(false);
    expect(azureReady()).toBe(false);
  });
});

describe("AzureSpeechRecognizer in continuous mode", () => {
  async function started(referenceText = "Carlos was quick.") {
    await prepareAzure();
    const r = new AzureSpeechRecognizer();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.referenceText = referenceText;
    const events: SREvent[] = [];
    const errors: string[] = [];
    let ended = 0;
    r.onresult = (e) => events.push(e);
    r.onerror = (e) => errors.push(e.error);
    r.onend = () => { ended++; };
    r.start();
    const rec = FakeRec.instances[0];
    return { r, rec, events, errors, ended: () => ended };
  }

  it("builds the SDK recognizer from the token, the mic and a word-level assessment of the story", async () => {
    const { rec } = await started("Carlos was quick.");
    expect(rec.cfg).toMatchObject({ token: "tok-1", region: "westus2", speechRecognitionLanguage: "en-US" });
    expect(rec.audio).toEqual({ mic: "default" });
    expect(rec.pa).toMatchObject({ referenceText: "Carlos was quick.", grading: 2, granularity: 2, miscue: true });
    expect(rec.started).toBe(true);
  });
  it("turns recognized segments into final results carrying Azure's word scores, and interim text into non-final ones", async () => {
    const { rec, events } = await started();
    rec.recognizing!(rec, { result: { reason: 2, text: "carlos" } });
    rec.recognized!(rec, { result: result("Carlos was quick.", [["carlos", "None", 96], ["was", "None", 100], ["quick", "Mispronunciation", 41]]) });
    expect(events).toHaveLength(2);
    expect(events[0].results[0].isFinal).toBe(false);
    expect(events[0].results[0][0].transcript).toBe("carlos");
    const fin = events[1].results[0];
    expect(fin.isFinal).toBe(true);
    expect(fin[0].transcript).toBe("Carlos was quick.");
    expect(fin.azure?.words.map((w) => w.word)).toEqual(["carlos", "was", "quick"]);
    expect(fin.azure?.words[2]).toMatchObject({ errorType: "Mispronunciation", accuracy: 41 });
    expect(fin.azure?.durationMs).toBe(2000);
  });
  it("ignores empty and no-match results", async () => {
    const { rec, events } = await started();
    rec.recognized!(rec, { result: result("", [], 0) });
    rec.recognized!(rec, { result: { reason: 3, text: "", properties: { getProperty: () => "" } } });
    expect(events).toHaveLength(0);
  });
  it("stop() ends the session, closes the SDK recognizer and fires onend once", async () => {
    const { r, rec, ended } = await started();
    r.stop();
    r.stop();
    await tick();
    expect(rec.stopped).toBe(true);
    expect(rec.closed).toBe(true);
    expect(ended()).toBe(1);
    expect(azureReady()).toBe(true);
  });
  it("abort() drops results that arrive late", async () => {
    const { r, rec, events } = await started();
    r.abort();
    rec.recognized!(rec, { result: result("late", [["late", "None", 90]]) });
    await tick();
    expect(events).toHaveLength(0);
  });
  it("an Azure error reports itself, ends, and hands the next start to the browser recognizer", async () => {
    const { rec, errors, ended } = await started();
    rec.canceled!(rec, { reason: 0, errorCode: 4, errorDetails: "Unable to contact server." });
    await tick();
    expect(errors).toEqual(["azure-connection"]);
    expect(ended()).toBe(1);
    expect(rec.closed).toBe(true);
    expect(azureReady()).toBe(false);
    expect(getSR()).toBeNull();
    expect(await prepareAzure()).toBe(false); // still cooling off
  });
  it("a blocked microphone is reported like the browser's not-allowed, without giving up on Azure", async () => {
    const { rec, errors } = await started();
    rec.canceled!(rec, { reason: 0, errorCode: 7, errorDetails: "NotAllowedError: Permission denied" });
    await tick();
    expect(errors).toEqual(["not-allowed"]);
    expect(azureReady()).toBe(true);
  });
  it("a session that stops on its own fires onend so the screen can restart it", async () => {
    const { rec, ended } = await started();
    rec.sessionStopped!(rec, {});
    await tick();
    expect(ended()).toBe(1);
  });
  it("refuses a second start on the same instance, like the browser API", async () => {
    const { r } = await started();
    expect(() => r.start()).toThrow(/already started/);
  });
  it("gives up on a session that never starts and hands over to the browser (the SDK retries a bad token silently)", async () => {
    vi.stubGlobal("navigator", { userAgent: "Chrome/155", permissions: { query: async () => ({ state: "granted" }) } });
    vi.useFakeTimers();
    try {
      const { rec, errors, ended } = await started();
      await vi.advanceTimersByTimeAsync(7900);
      expect(errors).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(errors).toEqual(["azure"]);
      expect(ended()).toBe(1);
      expect(rec.closed).toBe(true);
      expect(azureReady()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps a session that started, and waits longer while the microphone prompt is up", async () => {
    vi.stubGlobal("navigator", { userAgent: "Chrome/155", permissions: { query: async () => ({ state: "prompt" }) } });
    vi.useFakeTimers();
    try {
      const a = await started();
      await vi.advanceTimersByTimeAsync(9000);
      expect(a.errors).toEqual([]); // prompt: 30 s allowed
      a.rec.sessionStarted!(a.rec, {});
      await vi.advanceTimersByTimeAsync(60000);
      expect(a.errors).toEqual([]);
      expect(a.ended()).toBe(0);
      expect(azureReady()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("word practice through Azure", () => {
  it("assesses one utterance of the word and resolves with its accuracy", async () => {
    await prepareAzure();
    const l = practiceWord("volcano", 5000);
    const rec = FakeRec.instances[0];
    expect(rec.pa?.referenceText).toBe("volcano");
    rec.onceCb!(result("Volcano.", [["volcano", "None", 83]]));
    await expect(l.promise).resolves.toEqual({ alts: ["Volcano."], accuracy: 83 });
    expect(rec.closed).toBe(true);
  });
  it("gives 0 when she said something else, and no score when nothing was heard", async () => {
    await prepareAzure();
    const l = practiceWord("volcano", 5000);
    FakeRec.instances[0].onceCb!(result("Banana.", [["volcano", "Omission", 0], ["banana", "Insertion", 0]]));
    await expect(l.promise).resolves.toEqual({ alts: ["Banana."], accuracy: 0 });

    const l2 = practiceWord("volcano", 5000);
    FakeRec.instances[1].onceCb!({ reason: 0, text: "", properties: { getProperty: () => "" } });
    await expect(l2.promise).resolves.toEqual({ alts: [], accuracy: null });
  });
  it("abort() resolves with what was heard so far", async () => {
    await prepareAzure();
    const l = practiceWord("volcano", 5000);
    l.abort();
    await expect(l.promise).resolves.toEqual({ alts: [], accuracy: null });
  });
});

describe("mapAzureError", () => {
  const sdk = fakeSdk as unknown as Sdk;
  it("maps microphone trouble to the browser's names and Azure trouble to its own", () => {
    expect(mapAzureError(7, "NotAllowedError: Permission denied", sdk)).toBe("not-allowed");
    expect(mapAzureError(7, "NotFoundError: Requested device not found", sdk)).toBe("audio-capture");
    expect(mapAzureError(1, "WebSocket upgrade failed: Authentication error (401)", sdk)).toBe("azure-auth");
    expect(mapAzureError(8, "", sdk)).toBe("azure-auth");
    expect(mapAzureError(4, "Unable to contact server.", sdk)).toBe("azure-connection");
    expect(mapAzureError(5, "", sdk)).toBe("azure-connection");
    expect(mapAzureError(3, "", sdk)).toBe("azure-busy");
    expect(mapAzureError(6, "", sdk)).toBe("azure");
    expect(mapAzureError(undefined, "boom", null)).toBe("azure");
  });
});
