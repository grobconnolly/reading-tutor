"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Coach } from "@/hooks/useCoach";
import type { Passage } from "@/lib/passages";
import { shuffle } from "@/lib/words";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function QuizScreen({ coach, passage, onDone }: {
  coach: Coach;
  passage: Passage;
  onDone: (right: number, total: number) => void;
}) {
  const qs = useMemo(
    () => passage.questions.map((q) => ({ q: q.q, opts: shuffle(q.options.map((t, i) => ({ t, right: i === q.a }))) })),
    [passage],
  );
  const [i, setI] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const right = useRef(0);
  const coachRef = useRef(coach);
  coachRef.current = coach;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  function read(idx: number) {
    const q = qs[idx];
    return coachRef.current.say(q.q + " " + q.opts.map((o) => o.t).join(". Or, ") + "?", { caption: q.q, rate: 0.92 });
  }

  useEffect(() => {
    let live = true;
    (async () => {
      await coachRef.current.say("Now some questions about the story. Tap your answer.");
      if (live) read(0);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answer(k: number) {
    if (answered != null) return;
    setAnswered(k);
    const q = qs[i];
    const isRight = q.opts[k].right;
    if (isRight) {
      right.current++;
      await coachRef.current.say("That's right!");
    } else {
      const r = q.opts.find((o) => o.right)!;
      await coachRef.current.say("Good try. The answer is: " + r.t + ".");
    }
    if (i + 1 < qs.length) {
      await sleep(500);
      setAnswered(null);
      setI(i + 1);
      read(i + 1);
    } else {
      onDoneRef.current(right.current, qs.length);
    }
  }

  const q = qs[i];
  const rightIdx = q.opts.findIndex((o) => o.right);
  return (
    <section className="card stack">
      <p className="label">Question {i + 1} of {qs.length}</p>
      <h2>{q.q}</h2>
      <div className="opts">
        {q.opts.map((o, k) => {
          let c = "opt";
          if (answered != null) {
            if (k === rightIdx) c += " right";
            else if (k === answered) c += " wrong";
          }
          return (
            <button key={k} type="button" className={c} disabled={answered != null} onClick={() => answer(k)}>{o.t}</button>
          );
        })}
      </div>
      <div className="row"><button className="link" type="button" onClick={() => read(i)}>Read it to me again</button></div>
    </section>
  );
}
