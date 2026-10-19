"use client";

import { useState } from "react";
import { isValidPin, type Reader } from "@/lib/store";

export interface SetupData {
  parentPin: string;
  goal: number;
  reward: number;
  readers: { id: string; pin: string; interests: string }[];
}

export function SetupScreen({ readers, onSave }: { readers: Reader[]; onSave: (d: SetupData) => void }) {
  const [pins, setPins] = useState<Record<string, string>>(() => Object.fromEntries(readers.map((r) => [r.id, r.pin ?? ""])));
  const [interests, setInterests] = useState<Record<string, string>>(() => Object.fromEntries(readers.map((r) => [r.id, r.interests])));
  const [parentPin, setParentPin] = useState("");
  const [goal, setGoal] = useState("5");
  const [reward, setReward] = useState("5");
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const r of readers) if (!isValidPin(pins[r.id] ?? "")) return setErr(`${r.name}'s PIN needs to be 4 digits.`);
    if (!isValidPin(parentPin)) return setErr("The parent PIN needs to be 4 digits.");
    if (readers.some((r) => pins[r.id] === parentPin)) return setErr("Use a different PIN for the parent.");
    const seen = new Set<string>();
    for (const r of readers) {
      if (seen.has(pins[r.id])) return setErr("Give each reader her own PIN.");
      seen.add(pins[r.id]);
    }
    onSave({
      parentPin,
      goal: Math.min(14, Math.max(1, +goal || 5)),
      reward: Math.min(100, Math.max(1, +reward || 5)),
      readers: readers.map((r) => ({ id: r.id, pin: pins[r.id], interests: (interests[r.id] ?? "").trim() })),
    });
  }

  return (
    <section className="card stack">
      <div>
        <p className="label">First-time setup</p>
        <h1>Set up the reading coach</h1>
        <p className="muted">Takes a minute. Only a parent should see this screen.</p>
      </div>
      <form className="stack" autoComplete="off" onSubmit={submit}>
        {readers.map((r) => (
          <div key={r.id} className="grid2">
            <div className="span-all"><h3>{r.name}</h3></div>
            <label className="field">
              <span className="label">{r.name}&rsquo;s 4-digit PIN</span>
              <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={pins[r.id] ?? ""}
                onChange={(e) => setPins({ ...pins, [r.id]: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Her interests (for new stories)</span>
              <input type="text" placeholder="e.g. dogs, gymnastics, slime, mysteries" value={interests[r.id] ?? ""}
                onChange={(e) => setInterests({ ...interests, [r.id]: e.target.value })} />
            </label>
          </div>
        ))}
        <div className="grid2">
          <div className="span-all"><h3>Parent</h3></div>
          <label className="field">
            <span className="label">Parent 4-digit PIN</span>
            <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={parentPin} onChange={(e) => setParentPin(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Stories per week for the reward</span>
            <input type="number" min={1} max={14} required value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Weekly reward ($)</span>
            <input type="number" min={1} max={100} required value={reward} onChange={(e) => setReward(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button className="primary big" type="submit">Save and continue</button>
          <span className="err">{err}</span>
        </div>
      </form>
    </section>
  );
}
