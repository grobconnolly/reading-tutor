"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { WcpmChart } from "@/components/parent/WcpmChart";
import { useAppState } from "@/hooks/useAppState";
import { GRADE_FALL_WCPM, gradeLabel, MAX_LEVEL, MIN_LEVEL, ordinalGrade } from "@/lib/passages";
import { avgAccLast5, countedThisWeek, isValidPin, lastWcpm, owedWeeks, paidWeekList, PARENT_UNLOCK_KEY, streak, trickyWords, type Reader } from "@/lib/store";
import { weekLabel } from "@/lib/time";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ParentDashboard() {
  const router = useRouter();
  const { state, update, reset } = useAppState();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [sel, setSel] = useState("stella");

  useEffect(() => {
    try { setUnlocked(sessionStorage.getItem(PARENT_UNLOCK_KEY) === "1"); } catch { setUnlocked(false); }
  }, []);

  if (!state || unlocked === null) return <main className="wrap"><p className="muted">Loading…</p></main>;

  if (!state.parentPin) {
    return (
      <main className="wrap">
        <section className="card stack-sm">
          <h1>Not set up yet</h1>
          <p className="muted">Run first-time setup on the reader screen to choose PINs.</p>
          <div><Link href="/"><button className="primary" type="button">Go to setup</button></Link></div>
        </section>
      </main>
    );
  }

  if (!unlocked) {
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      if (pin === state.parentPin) {
        try { sessionStorage.setItem(PARENT_UNLOCK_KEY, "1"); } catch { /* ignore */ }
        setUnlocked(true);
      } else {
        setPinErr("That PIN doesn't match. Try again.");
        setPin("");
      }
    };
    return (
      <main className="wrap">
        <form className="card stack-sm" style={{ alignItems: "flex-start" }} onSubmit={submit}>
          <p className="label">Parent view</p>
          <h2>Parent PIN</h2>
          <input className="pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" aria-label="Parent PIN" autoFocus
            value={pin} onChange={(e) => setPin(e.target.value)} />
          <div className="row">
            <button className="primary" type="submit">Open</button>
            <Link href="/"><button className="link" type="button">Back</button></Link>
            <span className="err">{pinErr}</span>
          </div>
        </form>
      </main>
    );
  }

  const reader = state.readers.find((r) => r.id === sel) ?? state.readers[0];

  function logout() {
    try { sessionStorage.removeItem(PARENT_UNLOCK_KEY); } catch { /* ignore */ }
    router.push("/");
  }

  return (
    <main className="wrap">
      <div className="row between">
        <div>
          <p className="label">Parent view</p>
          <h1>{reader.name}&rsquo;s progress</h1>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Choose a reader">
            {state.readers.map((r) => (
              <button key={r.id} type="button" aria-pressed={r.id === reader.id} onClick={() => setSel(r.id)}>{r.name}</button>
            ))}
          </div>
          <button type="button" onClick={logout}>Log out</button>
        </div>
      </div>

      <BothGirls readers={state.readers} />
      <RewardCard reader={reader} onPaid={(weeks) => update((s) => {
        const r = s.readers.find((x) => x.id === reader.id)!;
        const now = new Date().toISOString();
        for (const w of weeks) r.paidWeeks[w] = now;
      })} />
      <StatsRow reader={reader} onRerunCheck={() => update((s) => { s.readers.find((x) => x.id === reader.id)!.baseline = null; })} />

      <section className="card">
        <h3>Words per minute over time</h3>
        <div style={{ marginTop: 10 }}>
          <WcpmChart values={reader.sessions.filter((s) => s.wcpm != null).map((s) => s.wcpm as number)}
            gradeAvg={GRADE_FALL_WCPM[reader.grade]} gradeLabel={ordinalGrade(reader.grade)} baseline={reader.baseline?.wcpm ?? null} />
        </div>
      </section>

      <section className="card stack-sm">
        <h3>Words she&rsquo;s working on</h3>
        <div className="chips">
          {trickyWords(reader, 30).length
            ? trickyWords(reader, 30).map((t) => <span key={t.word} className="chip">{t.word} <small>×{t.miss}</small></span>)
            : <span className="muted">None yet.</span>}
        </div>
      </section>

      <SessionsTable reader={reader} />
      <Settings key={reader.id} reader={reader} parentPin={state.parentPin} update={update} reset={reset} />
    </main>
  );
}

function BothGirls({ readers }: { readers: Reader[] }) {
  return (
    <section className="summary">
      {readers.map((r) => {
        const done = countedThisWeek(r);
        const won = done >= r.goal;
        return (
          <div key={r.id} className="stat stack-sm" style={{ gap: 4 }}>
            <span className="who">{r.name}</span>
            <span><b style={{ display: "inline", fontSize: "1.2rem" }}>{done} of {r.goal}</b> stories this week {won && <span className="ok-text">· earned ${r.reward}</span>}</span>
            <span className="muted small">{gradeLabel(r.level)} stories · {r.baseline ? `check on ${fmtDate(r.baseline.date)}` : "reading check not done yet"}</span>
          </div>
        );
      })}
    </section>
  );
}

function RewardCard({ reader, onPaid }: { reader: Reader; onPaid: (weeks: string[]) => void }) {
  const done = countedThisWeek(reader);
  const won = done >= reader.goal;
  const owed = owedWeeks(reader);
  const paid = paidWeekList(reader);
  return (
    <section className="card stack-sm">
      <h3>Weekly reward</h3>
      <p>This week: <b>{done} of {reader.goal}</b> stories {won && <>— <b style={{ color: "var(--money)" }}>earned ${reader.reward}</b></>}</p>
      {owed.length ? (
        <>
          <div className="note">You owe <b>${reader.reward * owed.length}</b> for {owed.length} week{owed.length > 1 ? "s" : ""}: {owed.map(weekLabel).join(", ")}.</div>
          <div><button className="primary" type="button" onClick={() => onPaid(owed)}>Mark as paid</button></div>
        </>
      ) : (
        <p className="muted">Nothing owed right now. A story counts once she reads at least 80% of it and answers the questions.</p>
      )}
      {paid.length > 0 && (
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="label">Paid</span>
          <div className="chips">
            {paid.map((p) => <span key={p.week} className="chip paid">{weekLabel(p.week)} <small>· paid {fmtDate(p.paidAt)}</small></span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function StatsRow({ reader, onRerunCheck }: { reader: Reader; onRerunCheck: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const avg = GRADE_FALL_WCPM[reader.grade];
  const acc = avgAccLast5(reader);
  return (
    <section className="stats">
      <div className="stat">
        <span className="label">Reading level</span>
        <b>{gradeLabel(reader.level)}</b>
        <span className="muted small">{reader.baseline ? `Check on ${new Date(reader.baseline.date).toLocaleDateString()}` : "Reading check not done yet"}</span>
        {reader.baseline && !confirm && <div><button className="link" type="button" onClick={() => setConfirm(true)}>Re-run reading check</button></div>}
        {confirm && (
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small">Next time she logs in she&rsquo;ll start with the check.</span>
            <button type="button" onClick={() => { onRerunCheck(); setConfirm(false); }}>Yes, re-run</button>
            <button className="link" type="button" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="stat">
        <span className="label">Latest words/min</span>
        <b>{lastWcpm(reader) ?? "–"}</b>
        <span className="muted small">{avg ? `${ordinalGrade(reader.grade)} fall avg ≈ ${avg}` : ""}{reader.baseline?.wcpm != null ? ` · baseline ${reader.baseline.wcpm}` : ""}</span>
      </div>
      <div className="stat">
        <span className="label">Accuracy (last 5)</span>
        <b>{acc != null ? `${acc}%` : "–"}</b>
        <span className="muted small">Target 95%+</span>
      </div>
      <div className="stat">
        <span className="label">Day streak</span>
        <b>{streak(reader)}</b>
      </div>
    </section>
  );
}

function SessionsTable({ reader }: { reader: Reader }) {
  const rows = reader.sessions.slice().reverse().slice(0, 40);
  return (
    <section className="card">
      <h3>Sessions</h3>
      <div className="scroll" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Story</th><th>Level</th><th>Words/min</th><th>Accuracy</th><th>Questions</th><th>Helped</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.date)}</td>
                <td>{s.title}{s.mode === "check" ? " (check)" : ""}</td>
                <td>{gradeLabel(s.level)}</td>
                <td>{s.wcpm ?? "–"}</td>
                <td>{s.acc}%</td>
                <td>{s.comp}/{s.compTotal}</td>
                <td>{s.helps}</td>
              </tr>
            )) : <tr><td colSpan={7} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Settings({ reader, parentPin, update, reset }: {
  reader: Reader;
  parentPin: string;
  update: ReturnType<typeof useAppState>["update"];
  reset: () => void;
}) {
  const [goal, setGoal] = useState(String(reader.goal));
  const [reward, setReward] = useState(String(reader.reward));
  const [interests, setInterests] = useState(reader.interests);
  const [level, setLevel] = useState(String(reader.level));
  const [startLevel, setStartLevel] = useState(String(reader.startLevel));
  const [readerPin, setReaderPin] = useState("");
  const [newParentPin, setNewParentPin] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmErase, setConfirmErase] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (readerPin && !isValidPin(readerPin)) return setErr("The reader PIN needs to be 4 digits.");
    if (newParentPin && !isValidPin(newParentPin)) return setErr("The parent PIN needs to be 4 digits.");
    const effectiveParent = newParentPin || parentPin;
    if (readerPin && readerPin === effectiveParent) return setErr("Use a different PIN for the parent.");
    const clamp = (v: string, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, +v || dflt));
    update((s) => {
      const r = s.readers.find((x) => x.id === reader.id)!;
      r.goal = clamp(goal, 1, 14, 5);
      r.reward = clamp(reward, 1, 100, 5);
      r.interests = interests.trim();
      r.level = clamp(level, MIN_LEVEL, MAX_LEVEL, r.level);
      r.startLevel = clamp(startLevel, MIN_LEVEL, MAX_LEVEL, r.startLevel);
      if (readerPin) r.pin = readerPin;
      if (newParentPin) s.parentPin = newParentPin;
    });
    setReaderPin("");
    setNewParentPin("");
    setMsg("Saved.");
  }

  return (
    <section className="card stack">
      <h3>Settings for {reader.name}</h3>
      <form className="grid2" autoComplete="off" onSubmit={submit}>
        <label className="field"><span className="label">Stories per week</span><input type="number" min={1} max={14} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <label className="field"><span className="label">Weekly reward ($)</span><input type="number" min={1} max={100} value={reward} onChange={(e) => setReward(e.target.value)} /></label>
        <label className="field span-all"><span className="label">Her interests (for new stories)</span><input type="text" value={interests} onChange={(e) => setInterests(e.target.value)} /></label>
        <label className="field"><span className="label">Reading level (1–7)</span><input type="number" min={MIN_LEVEL} max={MAX_LEVEL} value={level} onChange={(e) => setLevel(e.target.value)} /></label>
        <label className="field"><span className="label">Reading check starts at level (1–7)</span><input type="number" min={MIN_LEVEL} max={MAX_LEVEL} value={startLevel} onChange={(e) => setStartLevel(e.target.value)} /></label>
        <label className="field"><span className="label">New PIN for {reader.name} (leave blank to keep)</span><input type="password" inputMode="numeric" maxLength={4} value={readerPin} onChange={(e) => setReaderPin(e.target.value)} /></label>
        <label className="field"><span className="label">New parent PIN (leave blank to keep)</span><input type="password" inputMode="numeric" maxLength={4} value={newParentPin} onChange={(e) => setNewParentPin(e.target.value)} /></label>
        <div className="row span-all">
          <button className="primary" type="submit">Save settings</button>
          <span className="muted">{msg}</span>
          <span className="err">{err}</span>
        </div>
      </form>
      <div className="row">
        {!confirmErase && <button className="link" type="button" onClick={() => setConfirmErase(true)}>Erase all progress on this device</button>}
        {confirmErase && (
          <span className="row">
            <b className="err">Erase everything for both girls?</b>
            <button className="danger" type="button" onClick={() => { reset(); setConfirmErase(false); window.location.href = "/"; }}>Yes, erase</button>
            <button className="link" type="button" onClick={() => setConfirmErase(false)}>Cancel</button>
          </span>
        )}
      </div>
    </section>
  );
}
