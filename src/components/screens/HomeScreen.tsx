"use client";

import { homeGoalHeading } from "@/lib/reward";
import type { Reader } from "@/lib/store";

export function HomeScreen({ reader, done, streak, banner, onCheck, onPractice, onTricky, onLogout }: {
  reader: Reader;
  done: number;
  streak: number;
  banner: string | null;
  onCheck: () => void;
  onPractice: () => void;
  onTricky: () => void;
  onLogout: () => void;
}) {
  const won = done >= reader.goal;
  return (
    <section className="stack">
      {banner && <div className="banner">{banner}</div>}
      <div className="card goal">
        {reader.rewardKind === "cash"
          ? <div className={`bill${won ? " won" : ""}`}>${reader.reward}</div>
          : <div className={`gift${won ? " won" : ""}`} aria-hidden="true"><span className="bow" /><span className="lid" /><span className="box" /></div>}
        <div style={{ minWidth: 0 }}>
          <p className="label">This week&rsquo;s goal</p>
          <h2>{homeGoalHeading(reader, reader.goal, won)}</h2>
          <div className="dots">
            {Array.from({ length: reader.goal }, (_, i) => (
              <span key={i} className={`dot${i < done ? " on" : ""}`}>{i + 1}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="row">
        {!reader.baseline && <button className="primary big" type="button" onClick={onCheck}>Start reading check</button>}
        {reader.baseline && <button className="primary big" type="button" onClick={onPractice}>Read a story</button>}
        <button className="big" type="button" onClick={onTricky}>Tricky words</button>
      </div>
      <div className="stats">
        <div className="stat"><span className="label">Day streak</span><b>{streak}</b></div>
        <div className="stat"><span className="label">Stars</span><b>{reader.stars}</b></div>
        <div className="stat"><span className="label">Stories read</span><b>{reader.sessions.length}</b></div>
      </div>
      <div className="row"><button className="link" type="button" onClick={onLogout}>Log out</button></div>
    </section>
  );
}
