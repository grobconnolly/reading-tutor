"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Coach } from "@/hooks/useCoach";
import type { Passage } from "@/lib/passages";
import { applyAzureSegment, rememberAzureScores, summarizeAzure, type AzureAlignState, type AzureSegmentStat } from "@/lib/azureAlign";
import { RULES, scoreReading, type ReadResult } from "@/lib/scoring";
import { getSR, hasSR, listeningStatus, MIC_BLOCKED_MSG, prepareListening, type SpeechRecognizer, type SRResult } from "@/lib/speech";
import { advanceTokens, cleanWord, toReadWords, tokenize, type AlignState, type ReadWord, type WordStatus } from "@/lib/words";

/** Mutable reading state. Lives in a ref so recognizer callbacks and timers always see the latest values. */
interface Engine extends AzureAlignState {
  words: ReadWord[];
  startT: number | null;
  endT: number | null;
  lastProg: number;
  active: boolean;
  paused: boolean;
  nudged: boolean;
  openedAt: number;
  helps: string[];
  /** Interim text the recognizer has not finalized yet. Safari can end a segment without finalizing it. */
  pendingInterim: string;
  /** Azure only: fluency and length of each utterance it scored, for the session scores. */
  azureSegs: AzureSegmentStat[];
}

function freshEngine(words: ReadWord[]): Engine {
  return { words, status: words.map(() => "todo"), p: 0, azureAcc: words.map(() => null), startT: null, endT: null, lastProg: 0, active: false, paused: false, nudged: false, openedAt: 0, helps: [], pendingInterim: "", azureSegs: [] };
}

/** She is being heard: reset the stall clock, and the WCPM clock if this is committed progress. */
function markActivity(R: Engine, committed: boolean) {
  const now = Date.now();
  R.lastProg = now;
  if (committed) R.endT = now;
  if (R.startT == null) R.startT = R.openedAt + Math.min(1500, now - R.openedAt);
}

/** Apply a final result. Azure's segments carry per-word scores, so they map straight onto the story; the browser
 *  recognizer offers a few guesses instead, and the one that fits the story best is kept. */
function commitFinal(R: Engine, r: SRResult) {
  if (r.azure) {
    const gain = applyAzureSegment(R, r.azure);
    R.azureSegs.push({ fluency: r.azure.fluency, durationMs: r.azure.durationMs });
    if (gain > 0) markActivity(R, true);
    return;
  }
  let best: AlignState | null = null;
  let bestGain = -1;
  const n = Math.max(1, r.length);
  for (let a = 0; a < n; a++) {
    const alt = r[a];
    if (!alt) continue;
    const trial: AlignState = { words: R.words, status: R.status.slice(), p: R.p };
    const gain = advanceTokens(trial, tokenize(alt.transcript));
    if (gain > bestGain) { bestGain = gain; best = trial; }
  }
  if (best && bestGain > 0) {
    R.status = best.status;
    R.p = best.p;
    markActivity(R, true);
  }
}

/** Keep whatever was heard but never finalized. */
function commitPending(R: Engine) {
  if (!R.pendingInterim) return;
  const gain = advanceTokens(R, tokenize(R.pendingInterim));
  R.pendingInterim = "";
  if (gain > 0) markActivity(R, true);
}

export function ReadScreen({ coach, passage, mode, kicker, intro, onFinish, onQuit }: {
  coach: Coach;
  passage: Passage;
  mode: "check" | "practice";
  kicker: string;
  intro: string;
  onFinish: (result: ReadResult) => void;
  onQuit: () => void;
}) {
  const words = useMemo(() => toReadWords(passage.text), [passage]);
  /** What Azure scores her reading against. */
  const storyText = useMemo(() => words.map((w) => w.disp).join(" "), [words]);
  const eng = useRef<Engine>(freshEngine(words));
  const [view, setView] = useState<{ status: WordStatus[]; p: number; active: boolean }>({ status: eng.current.status.slice(), p: 0, active: false });
  const [reading, setReading] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micLabel, setMicLabel] = useState("Listening");
  const [modelIdx, setModelIdx] = useState(-1);
  const recRef = useRef<SpeechRecognizer | null>(null);
  const recGen = useRef(0);
  const ticker = useRef<number | null>(null);
  const finished = useRef(false);
  const modelTimer = useRef<number | null>(null);
  const coachRef = useRef(coach);
  coachRef.current = coach;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const render = useCallback((pv?: AlignState) => {
    const st = pv ?? eng.current;
    setView({ status: st.status.slice(), p: st.p, active: eng.current.active });
  }, []);

  const stopRec = useCallback(() => {
    recGen.current++;
    try { recRef.current?.abort(); } catch { /* ignore */ }
    recRef.current = null;
    setMicOn(false);
    coachRef.current.setListening(false);
  }, []);

  const clearTicker = useCallback(() => {
    if (ticker.current != null) { window.clearInterval(ticker.current); ticker.current = null; }
  }, []);

  const finishReading = useCallback(() => {
    const R = eng.current;
    if (!R.active || finished.current) return;
    finished.current = true;
    R.active = false;
    commitPending(R);
    stopRec();
    clearTicker();
    render();
    const result = scoreReading(R.words, R.status, R.p, R.startT, R.endT, R.helps.length);
    const azure = summarizeAzure(R, R.azureSegs);
    if (azure) result.azure = azure;
    rememberAzureScores(azure);
    onFinishRef.current(result);
  }, [stopRec, clearTicker, render]);

  /** Stop listening and explain why, leaving her on the story so she can tap Start reading again. */
  const stopWithMessage = useCallback((msg: string) => {
    coachRef.current.bubble(msg);
    eng.current.active = false;
    stopRec();
    clearTicker();
    setReading(false);
    render();
  }, [stopRec, clearTicker, render]);
  const rapidEnds = useRef(0);

  const startRec = useCallback(function startRecInner() {
    const SR = getSR();
    if (!SR) return;
    const my = ++recGen.current;
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.referenceText = storyText;
    rec.onresult = (e) => {
      const R = eng.current;
      if (my !== recGen.current || !R.active || R.paused) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          commitFinal(R, r);
          R.pendingInterim = "";
        } else {
          interim += r[0].transcript + " ";
        }
      }
      if (interim) {
        // Preview interim words without committing them, but count them as activity so the
        // stall help never fires on a word she is in the middle of saying.
        R.pendingInterim = interim;
        const pv: AlignState = { words: R.words, status: R.status.slice(), p: R.p };
        advanceTokens(pv, tokenize(interim));
        if (pv.p > R.p) markActivity(R, false);
        render(pv);
      } else {
        render();
      }
      if (R.p >= R.words.length) finishReading();
    };
    rec.onerror = (e) => {
      if (my !== recGen.current) return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") stopWithMessage(MIC_BLOCKED_MSG);
      else if (e.error === "audio-capture") stopWithMessage("I can't find a microphone. Ask a grown-up to check it, then tap start reading again.");
      else if (e.error === "network") stopWithMessage("Listening needs the internet. Check the connection, then tap start reading again.");
      // "no-speech" and "aborted" are routine; onend restarts the recognizer.
    };
    const startedAt = Date.now();
    rec.onend = () => {
      if (my !== recGen.current) return;
      const R = eng.current;
      if (!R.active || R.paused) return;
      if (R.pendingInterim) {
        commitPending(R);
        render();
        if (R.p >= R.words.length) { finishReading(); return; }
      }
      rapidEnds.current = Date.now() - startedAt < 700 ? rapidEnds.current + 1 : 0;
      if (rapidEnds.current >= 6) { stopWithMessage("I'm having trouble listening. Tap start reading to try again."); return; }
      try { startRecInner(); } catch { /* ignore */ }
    };
    try {
      rec.start();
      recRef.current = rec;
      setMicOn(true);
      setMicLabel(listeningStatus());
      coachRef.current.setListening(true);
    } catch { /* ignore */ }
  }, [render, finishReading, stopWithMessage, storyText]);

  const helpWord = useCallback(async () => {
    const R = eng.current;
    R.paused = true;
    stopRec();
    const i = R.p;
    const w = cleanWord(R.words[i].disp);
    R.status[i] = "help";
    R.helps.push(w);
    R.p++;
    render();
    await coachRef.current.say(`That word is ${w}.`, { rate: 0.8 });
    R.lastProg = Date.now();
    R.paused = false;
    if (R.p >= R.words.length) { finishReading(); return; }
    if (R.active) startRec();
  }, [stopRec, render, finishReading, startRec]);

  const tick = useCallback(async () => {
    const R = eng.current;
    if (!R.active || R.paused || coachRef.current.isSpeaking()) return;
    const now = Date.now();
    if (R.startT == null) {
      if (!R.nudged && now - R.openedAt > RULES.firstWordNudgeMs) {
        R.nudged = true;
        R.paused = true;
        stopRec();
        await coachRef.current.say("Go ahead and read out loud. Start with the first word: " + cleanWord(R.words[0].disp) + ".");
        R.paused = false;
        R.lastProg = Date.now();
        if (R.active) startRec();
      }
      return;
    }
    if (now - R.lastProg > RULES.stallMs && R.p < R.words.length) await helpWord();
  }, [stopRec, startRec, helpWord]);

  // Mount: fresh engine, Juno's intro, and the Azure token so "Start reading" can open the mic in the same tap.
  // Unmount: stop everything.
  useEffect(() => {
    eng.current = freshEngine(words);
    finished.current = false;
    render();
    void prepareListening();
    coachRef.current.say(intro);
    return () => {
      stopRec();
      clearTicker();
      if (modelTimer.current != null) window.clearTimeout(modelTimer.current);
      eng.current.active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onStart() {
    if (!hasSR()) {
      coachRef.current.bubble("Listening needs Chrome, Edge, or Safari. Ask a grown-up to open this page in one of those.");
      return;
    }
    coachRef.current.cancel();
    const R = eng.current;
    R.active = true;
    R.openedAt = Date.now();
    R.lastProg = Date.now();
    rapidEnds.current = 0;
    setReading(true);
    coachRef.current.bubble("I'm listening. Start with the first word.");
    render();
    startRec();
    clearTicker();
    ticker.current = window.setInterval(() => { void tick(); }, 400);
  }

  function onRestart() {
    stopRec();
    clearTicker();
    eng.current = freshEngine(words);
    finished.current = false;
    setReading(false);
    render();
    coachRef.current.say("Let's start over. Take your time.");
  }

  function onQuitClick() {
    stopRec();
    clearTicker();
    eng.current.active = false;
    onQuit();
  }

  /** "Hear it first": Juno reads the story while each word highlights. The cloud voice sends a start time per word;
   *  the device voice fires word-boundary events in some browsers; otherwise timings are estimated (iOS Safari often
   *  fires none). */
  async function onModel() {
    if (eng.current.active) return;
    const text = words.map((w) => w.disp).join(" ");
    const starts: number[] = [];
    let pos = 0;
    for (const w of words) { starts.push(pos); pos += w.disp.length + 1; }
    const rate = 0.85;
    let gotBoundary = false;
    const stopEstimate = () => { if (modelTimer.current != null) { window.clearTimeout(modelTimer.current); modelTimer.current = null; } };
    const estimate = () => {
      // About 75 ms per character at this rate, split across words by length.
      const msPerChar = 75 / rate;
      let i = 0;
      const step = () => {
        if (gotBoundary || i >= words.length) return;
        setModelIdx(i);
        const dur = (words[i].disp.length + 1) * msPerChar;
        i++;
        modelTimer.current = window.setTimeout(step, dur);
      };
      step();
    };
    await coachRef.current.say(text, {
      rate,
      caption: "Listen and follow along with your eyes.",
      onstart: () => { modelTimer.current = window.setTimeout(() => { if (!gotBoundary) estimate(); }, 900); },
      onboundary: (e) => {
        if (e.name && e.name !== "word") return;
        gotBoundary = true;
        stopEstimate();
        const i = starts.findIndex((s, k) => e.charIndex >= s && (k === starts.length - 1 || e.charIndex < starts[k + 1]));
        if (i >= 0) setModelIdx(i);
      },
      onword: (i) => {
        gotBoundary = true;
        stopEstimate();
        if (i < words.length) setModelIdx(i);
      },
    });
    gotBoundary = true;
    stopEstimate();
    setModelIdx(-1);
    coachRef.current.bubble("Your turn! Tap start reading when you're ready.");
  }

  const pct = Math.round((100 * view.p) / Math.max(1, words.length));

  return (
    <section className="card stack">
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          <p className="label">{kicker}</p>
          <h2>{passage.title}</h2>
        </div>
        <span>{micOn && <span className="mic">{micLabel}</span>}</span>
      </div>
      <div className="progress" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <div className="passage">
        {words.map((w, i) => {
          let c = "w";
          const s = view.status[i];
          if (s !== "todo") c += " " + s;
          else if (view.active && i === view.p) c += " cur";
          if (i === modelIdx) c += " model";
          return (
            <Fragment key={i}>{i > 0 ? " " : ""}<span className={c}>{w.disp}</span></Fragment>
          );
        })}
      </div>
      <div className="legend">
        <span style={{ "--sw": "var(--ok)" } as React.CSSProperties}>Read it</span>
        <span style={{ "--sw": "var(--help)" } as React.CSSProperties}>Coach helped</span>
        <span style={{ "--sw": "var(--miss)" } as React.CSSProperties}>Skipped</span>
        <span style={{ "--sw": "var(--warn)" } as React.CSSProperties}>Misread</span>
      </div>
      <div className="row">
        {!reading && <button className="primary big" type="button" onClick={onStart}>Start reading</button>}
        {!reading && mode === "practice" && <button className="big" type="button" onClick={onModel}>Hear it first</button>}
        {reading && <button className="big" type="button" onClick={finishReading}>I&rsquo;m done</button>}
        {reading && <button className="link" type="button" onClick={onRestart}>Start over</button>}
        <button className="link" type="button" onClick={onQuitClick}>Back</button>
      </div>
    </section>
  );
}
