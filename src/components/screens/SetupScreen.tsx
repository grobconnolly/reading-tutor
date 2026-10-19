"use client";

import { useState } from "react";
import { RewardChoice } from "@/components/parent/ParentDashboard";
import type { RewardKind } from "@/lib/reward";
import { isValidPin, type Reader } from "@/lib/store";

export interface SetupData {
  parentPin: string;
  goal: number;
  reward: number;
  rewardKind: RewardKind;
  rewardLabel: string;
  readers: { id: string; pin: string; interests: string }[];
}

export function SetupScreen({ readers, onSave }: { readers: Reader[]; onSave: (d: SetupData) => Promise<string | null> }) {
  const [pins, setPins] = useState<Record<string, string>>(() => Object.fromEntries(readers.map((r) => [r.id, ""])));
  const [interests, setInterests] = useState<Record<string, string>>(() => Object.fromEntries(readers.map((r) => [r.id, r.interests])));
  const [parentPin, setParentPin] = useState("");
  const [goal, setGoal] = useState(String(readers[0]?.goal ?? 5));
  const [reward, setReward] = useState(String(readers[0]?.reward ?? 5));
  const [rewardKind, setRewardKind] = useState<RewardKind>(readers[0]?.rewardKind ?? "prize");
  const [rewardLabel, setRewardLabel] = useState(readers[0]?.rewardLabel ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    for (const r of readers) if (!isValidPin(pins[r.id] ?? "")) return setErr(`${r.name}'s PIN needs to be 4 digits.`);
    if (!isValidPin(parentPin)) return setErr("The parent PIN needs to be 4 digits.");
    if (readers.some((r) => pins[r.id] === parentPin)) return setErr("Use a different PIN for the parent.");
    const seen = new Set<string>();
    for (const r of readers) {
      if (seen.has(pins[r.id])) return setErr("Give each reader her own PIN.");
      seen.add(pins[r.id]);
    }
    setErr("");
    setBusy(true);
    const problem = await onSave({
      parentPin,
      goal: Math.min(14, Math.max(1, +goal || 5)),
      reward: Math.min(100, Math.max(1, +reward || 5)),
      rewardKind,
      rewardLabel: rewardLabel.trim(),
      readers: readers.map((r) => ({ id: r.id, pin: pins[r.id], interests: (interests[r.id] ?? "").trim() })),
    });
    setBusy(false);
    if (problem) setErr(problem);
  }

  return (
    <section className="card stack">
      <div>
        <p className="label">First-time setup</p>
        <h1>Set up the reading coach</h1>
        <p className="muted">Takes a minute. Only a parent should see this screen. PINs are stored hashed and checked on the server.</p>
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
            <span className="label">Stories per week</span>
            <input type="number" min={1} max={14} required value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <RewardChoice kind={rewardKind} amount={reward} label={rewardLabel} onKind={setRewardKind} onAmount={setReward} onLabel={setRewardLabel} />
        </div>
        <div className="row">
          <button className="primary big" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
          <span className="err">{err}</span>
        </div>
      </form>
    </section>
  );
}
