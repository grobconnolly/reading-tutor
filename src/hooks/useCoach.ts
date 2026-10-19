"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSynth, pickVoice, pitchFor } from "@/lib/speech";
import { cloudVoice, fetchLine, installAudioUnlock, noteLineFailure, noteLineSuccess, playLine, stopAudio } from "@/lib/ttsClient";

export interface SayOpts {
  /** Show the text in the bubble (default true). */
  show?: boolean;
  /** Bubble text, if different from what is spoken. */
  caption?: string;
  rate?: number;
  /** Device voice only: the browser's own word-boundary events. */
  onboundary?: (e: SpeechSynthesisEvent) => void;
  onstart?: () => void;
  /** Cloud voice only: fires with the index of each whitespace-separated word as it starts. */
  onword?: (index: number) => void;
}

export interface Coach {
  text: string;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
  /** True once the server has confirmed Juno's cloud (Azure) voice; the device voice is only a fallback then. */
  cloudVoice: boolean;
  /** Speak a line (and show it). Resolves when speech ends, or after a safety timeout. */
  say: (text: string, opts?: SayOpts) => Promise<void>;
  /** Show a line without speaking it. */
  bubble: (text: string) => void;
  toggleMute: () => void;
  /** Stop any speech in progress. */
  cancel: () => void;
  setListening: (on: boolean) => void;
  /** Synchronous check for timers. */
  isSpeaking: () => boolean;
}

const DEFAULT_RATE = 0.95;

/** Coach Juno's voice and face state. Shared by every reader screen. */
export function useCoach(): Coach {
  const [text, setText] = useState("Hi!");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [cloud, setCloud] = useState(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  /** Bumped by every say() and cancel(); a line whose number is stale never starts. */
  const genRef = useRef(0);
  /** Resolves the say() in progress, if any. */
  const finRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    installAudioUnlock();
    let alive = true;
    cloudVoice().then((cv) => { if (alive) setCloud(!!cv); });
    const synth = getSynth();
    if (!synth) return () => { alive = false; };
    const pick = () => { voiceRef.current = pickVoice(); };
    pick();
    synth.addEventListener("voiceschanged", pick);
    return () => { alive = false; synth.removeEventListener("voiceschanged", pick); };
  }, []);

  const setSpeak = useCallback((on: boolean) => {
    speakingRef.current = on;
    setSpeaking(on);
  }, []);

  const bubble = useCallback((t: string) => setText(t), []);

  /** Stop the line in progress, device or cloud, and resolve its promise. */
  const stopCurrent = useCallback(() => {
    getSynth()?.cancel();
    stopAudio();
    finRef.current?.();
  }, []);

  const speakWithDevice = useCallback((line: string, opts: SayOpts, fin: () => void) => {
    const synth = getSynth();
    if (!synth) { fin(); return; }
    const u = new SpeechSynthesisUtterance(line);
    utterRef.current = u; // keep a reference so the browser doesn't drop the utterance mid-speech
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = opts.rate ?? DEFAULT_RATE;
    u.pitch = pitchFor(voiceRef.current);
    u.onend = fin;
    u.onerror = fin;
    if (opts.onboundary) u.onboundary = opts.onboundary;
    if (opts.onstart) u.onstart = opts.onstart;
    setSpeak(true);
    synth.speak(u);
    setTimeout(fin, 2000 + (line.length * 95) / u.rate);
  }, [setSpeak]);

  const say = useCallback((line: string, opts: SayOpts = {}) => {
    if (opts.show !== false) setText(opts.caption ?? line);
    const gen = ++genRef.current;
    stopCurrent();
    if (mutedRef.current) return Promise.resolve();
    return new Promise<void>((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        if (finRef.current === fin) finRef.current = null;
        setSpeak(false);
        res();
      };
      finRef.current = fin;
      const stale = () => gen !== genRef.current;
      void (async () => {
        const cv = await cloudVoice();
        if (stale()) { fin(); return; }
        if (cv) {
          try {
            const clip = await fetchLine(cv, line, opts.rate ?? DEFAULT_RATE);
            if (stale()) { fin(); return; }
            const play = playLine(clip, {
              onstart: () => { setSpeak(true); opts.onstart?.(); },
              onword: opts.onword,
            });
            await play.started;
            noteLineSuccess();
            play.finished.then(fin);
            return;
          } catch {
            if (stale()) { fin(); return; }
            noteLineFailure(); // fall through to the device voice for this line
          }
        }
        speakWithDevice(line, opts, fin);
      })();
    });
  }, [setSpeak, stopCurrent, speakWithDevice]);

  const cancel = useCallback(() => {
    genRef.current++;
    stopCurrent();
    setSpeak(false);
  }, [setSpeak, stopCurrent]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) cancel();
  }, [cancel]);

  const isSpeaking = useCallback(() => speakingRef.current, []);

  return { text, muted, speaking, listening, cloudVoice: cloud, say, bubble, toggleMute, cancel, setListening, isSpeaking };
}
