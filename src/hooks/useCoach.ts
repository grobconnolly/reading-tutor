"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSynth, pickVoice, pitchFor } from "@/lib/speech";

export interface SayOpts {
  /** Show the text in the bubble (default true). */
  show?: boolean;
  /** Bubble text, if different from what is spoken. */
  caption?: string;
  rate?: number;
  onboundary?: (e: SpeechSynthesisEvent) => void;
  onstart?: () => void;
}

export interface Coach {
  text: string;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
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

/** Coach Juno's voice and face state. Shared by every reader screen. */
export function useCoach(): Coach {
  const [text, setText] = useState("Hi!");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = getSynth();
    if (!synth) return;
    const pick = () => { voiceRef.current = pickVoice(); };
    pick();
    synth.addEventListener("voiceschanged", pick);
    return () => synth.removeEventListener("voiceschanged", pick);
  }, []);

  const setSpeak = useCallback((on: boolean) => {
    speakingRef.current = on;
    setSpeaking(on);
  }, []);

  const bubble = useCallback((t: string) => setText(t), []);

  const say = useCallback((line: string, opts: SayOpts = {}) => {
    if (opts.show !== false) setText(opts.caption ?? line);
    return new Promise<void>((res) => {
      const synth = getSynth();
      if (!synth || mutedRef.current) { res(); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(line);
      utterRef.current = u; // keep a reference so the browser doesn't drop the utterance mid-speech
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = opts.rate ?? 0.95;
      u.pitch = pitchFor(voiceRef.current);
      let done = false;
      const fin = () => { if (done) return; done = true; setSpeak(false); res(); };
      u.onend = fin;
      u.onerror = fin;
      if (opts.onboundary) u.onboundary = opts.onboundary;
      if (opts.onstart) u.onstart = opts.onstart;
      setSpeak(true);
      synth.speak(u);
      setTimeout(fin, 2000 + (line.length * 95) / u.rate);
    });
  }, [setSpeak]);

  const cancel = useCallback(() => {
    const synth = getSynth();
    if (synth) synth.cancel();
    setSpeak(false);
  }, [setSpeak]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) cancel();
  }, [cancel]);

  const isSpeaking = useCallback(() => speakingRef.current, []);

  return { text, muted, speaking, listening, say, bubble, toggleMute, cancel, setListening, isSpeaking };
}
