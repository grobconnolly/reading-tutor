"use client";

import { useEffect, useRef, useState } from "react";
import type { Coach } from "@/hooks/useCoach";
import { hasSR, listenOnce, MIC_BLOCKED_MSG, type Listener } from "@/lib/speech";
import { transcriptHasWord } from "@/lib/words";

const PRAISE = ["Yes! Perfect.", "You got it!", "Nice job!"];

type Result = "" | "good" | "almost" | "later";

/** One word at a time: Juno says it, she says it back, one retry, then move on. */
export function WordPracticeScreen({ coach, list, intro, onResult, onDone }: {
  coach: Coach;
  list: string[];
  intro: string;
  onResult: (word: string, hit: boolean) => void;
  onDone: (wins: number) => void;
}) {
  const [i, setI] = useState(0);
  const [result, setResult] = useState<Result>("");
  const [micOn, setMicOn] = useState(false);
  const gen = useRef(0);
  const tries = useRef(0);
  const wins = useRef(0);
  const listener = useRef<Listener | null>(null);
  const coachRef = useRef(coach);
  coachRef.current = coach;
  const cb = useRef({ onResult, onDone });
  cb.current = { onResult, onDone };

  function stopListening() {
    listener.current?.abort();
    listener.current = null;
    setMicOn(false);
    coachRef.current.setListening(false);
  }

  async function show(idx: number) {
    const g = ++gen.current;
    stopListening();
    if (idx >= list.length) { cb.current.onDone(wins.current); return; }
    setI(idx);
    tries.current = 0;
    setResult("");
    const w = list[idx];
    await coachRef.current.say(`This word is ${w}.`, { caption: `This word is "${w}".` });
    if (g !== gen.current) return;
    await coachRef.current.say(w, { rate: 0.55, show: false });
    if (g !== gen.current) return;
    listen(idx);
  }

  async function listen(idx: number) {
    const g = gen.current;
    const w = list[idx];
    if (!hasSR()) { coachRef.current.bubble("Say it out loud, then tap next word."); return; }
    stopListening();
    coachRef.current.bubble("Your turn. Say it!");
    setMicOn(true);
    coachRef.current.setListening(true);
    const l = listenOnce(6000, () => coachRef.current.bubble(MIC_BLOCKED_MSG));
    listener.current = l;
    const alts = await l.promise;
    if (g !== gen.current) return;
    listener.current = null;
    setMicOn(false);
    coachRef.current.setListening(false);
    const hit = alts.some((a) => transcriptHasWord(a, w));
    cb.current.onResult(w, hit);
    if (hit) {
      wins.current++;
      setResult("good");
      await coachRef.current.say(PRAISE[idx % 3]);
      if (g !== gen.current) return;
      show(idx + 1);
    } else if (tries.current === 0) {
      tries.current = 1;
      setResult("almost");
      await coachRef.current.say(`Listen again. ${w}.`, { rate: 0.7 });
      if (g !== gen.current) return;
      listen(idx);
    } else {
      setResult("later");
      await coachRef.current.say("That's a tricky one. We'll come back to it.");
      if (g !== gen.current) return;
      show(idx + 1);
    }
  }

  useEffect(() => {
    let live = true;
    (async () => {
      await coachRef.current.say(intro);
      if (live) show(0);
    })();
    return () => { live = false; gen.current++; stopListening(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = list[i] ?? "";
  return (
    <section className="card stack-sm">
      <div className="row between">
        <p className="label">Word {Math.min(i + 1, list.length)} of {list.length}</p>
        <span>{micOn && <span className="mic">Listening</span>}</span>
      </div>
      <div className="bigword">{w}</div>
      <div style={{ textAlign: "center", minHeight: "2em" }}>
        {result === "good" && <span className="result-pill good">Got it!</span>}
        {result === "almost" && <span className="result-pill bad">Almost</span>}
        {result === "later" && <span className="result-pill bad">We&rsquo;ll practice it later</span>}
      </div>
      <div className="row center">
        <button className="big" type="button" onClick={() => coachRef.current.say(w, { rate: 0.55 })}>Hear it</button>
        <button className="primary big" type="button" onClick={() => listen(i)}>My turn</button>
        <button className="link" type="button" onClick={() => show(i + 1)}>Next word</button>
      </div>
    </section>
  );
}
