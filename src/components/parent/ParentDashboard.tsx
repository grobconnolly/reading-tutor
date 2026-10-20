"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { WcpmChart } from "@/components/parent/WcpmChart";
import type { AzureDetail } from "@/lib/azureAlign";
import { useAppState, type AppActions } from "@/hooks/useAppState";
import { recordingUrl, verifyPin } from "@/lib/data";
import { GRADE_FALL_WCPM, gradeLabel, MAX_LEVEL, MIN_LEVEL, ordinalGrade } from "@/lib/passages";
import { earnedShort, markButton, owedSummary, paidWord, type RewardKind } from "@/lib/reward";
import { avgAccLast5, countedThisWeek, isValidPin, lastWcpm, owedWeeks, paidWeekList, PARENT_UNLOCK_KEY, streak, trickyWords, type Reader } from "@/lib/store";
import { weekLabel } from "@/lib/time";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ParentDashboard() {
  const router = useRouter();
  const app = useAppState();
  const { state, error, refresh } = app;
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    try { setUnlocked(sessionStorage.getItem(PARENT_UNLOCK_KEY) === "1"); } catch { setUnlocked(false); }
  }, []);

  if (error && !state) {
    return (
      <main className="wrap">
        <section className="card stack-sm">
          <h2>Couldn&rsquo;t load</h2>
          <p className="err">{error}</p>
          <div className="row">
            <button className="primary" type="button" onClick={() => void refresh()}>Try again</button>
            <form action="/auth/signout" method="post"><button className="link" type="submit">Sign out</button></form>
          </div>
        </section>
      </main>
    );
  }
  if (!state || unlocked === null) return <main className="wrap"><p className="muted">Loading…</p></main>;

  if (!state.parentPinSet) {
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
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      const res = await verifyPin("parent", pin);
      setBusy(false);
      if (res.ok) {
        try { sessionStorage.setItem(PARENT_UNLOCK_KEY, "1"); } catch { /* ignore */ }
        setUnlocked(true);
      } else {
        setPinErr(res.message ?? "That PIN doesn't match. Try again.");
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
            <button className="primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Open"}</button>
            <Link href="/"><button className="link" type="button">Back</button></Link>
            <span className="err">{pinErr}</span>
          </div>
        </form>
      </main>
    );
  }

  const reader = state.readers.find((r) => r.id === sel) ?? state.readers[0];
  if (!reader) {
    return (
      <main className="wrap">
        <section className="card stack-sm">
          <h2>No readers yet</h2>
          <p className="muted">This account has no reader profiles. Run the Supabase migrations from the README, then sign out and back in.</p>
          <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
        </section>
      </main>
    );
  }

  function lock() {
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
          <button type="button" onClick={lock}>Log out</button>
        </div>
      </div>

      <BothGirls readers={state.readers} />
      <RewardCard reader={reader} onPaid={(weeks) => app.markPaid(reader.id, weeks)} />
      <StatsRow reader={reader} onRerunCheck={() => app.rerunCheck(reader.id)} />

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
      <Settings key={reader.id} reader={reader} app={app} />

      <section className="card stack-sm">
        <h3>This device</h3>
        <p className="muted small">Signed in as the parent. Both girls can use this device by tapping their names on the reader screen. Signing out here means a new sign-in link is needed to use this device again.</p>
        <form action="/auth/signout" method="post"><button type="submit">Sign out of this device</button></form>
      </section>
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
            <span><b style={{ display: "inline", fontSize: "1.2rem" }}>{done} of {r.goal}</b> stories this week {won && <span className="ok-text">· {earnedShort(r)}</span>}</span>
            <span className="muted small">{r.baseline ? `${gradeLabel(r.level)} stories · check on ${fmtDate(r.baseline.date)}` : "Reading check not done yet"}</span>
          </div>
        );
      })}
    </section>
  );
}

function RewardCard({ reader, onPaid }: { reader: Reader; onPaid: (weeks: string[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const done = countedThisWeek(reader);
  const won = done >= reader.goal;
  const owed = owedWeeks(reader);
  const paid = paidWeekList(reader);
  async function pay() {
    setBusy(true);
    setErr("");
    try { await onPaid(owed); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    setBusy(false);
  }
  return (
    <section className="card stack-sm">
      <h3>Weekly reward</h3>
      <p>This week: <b>{done} of {reader.goal}</b> stories {won && <>— <b style={{ color: "var(--money)" }}>{earnedShort(reader)}</b></>}</p>
      {owed.length ? (
        <>
          <div className="note"><b>{owedSummary(reader, owed.length)}</b>: {owed.map(weekLabel).join(", ")}.</div>
          <div className="row"><button className="primary" type="button" disabled={busy} onClick={pay}>{markButton(reader)}</button><span className="err">{err}</span></div>
        </>
      ) : (
        <p className="muted">Nothing {reader.rewardKind === "cash" ? "owed" : "to give"} right now. A story counts once she reads at least 80% of it and answers the questions.</p>
      )}
      {paid.length > 0 && (
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="label">{reader.rewardKind === "cash" ? "Paid" : "Given"}</span>
          <div className="chips">
            {paid.map((p) => <span key={p.week} className="chip paid">{weekLabel(p.week)} <small>· {paidWord(reader)} {fmtDate(p.paidAt)}</small></span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function StatsRow({ reader, onRerunCheck }: { reader: Reader; onRerunCheck: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const avg = GRADE_FALL_WCPM[reader.grade];
  const acc = avgAccLast5(reader);
  return (
    <section className="stats">
      <div className="stat">
        <span className="label">Reading level</span>
        <b style={reader.baseline ? undefined : { fontSize: "1.2rem" }}>{reader.baseline ? gradeLabel(reader.level) : "Not checked yet"}</b>
        <span className="muted small">{reader.baseline ? `Check on ${new Date(reader.baseline.date).toLocaleDateString()}` : `She does the reading check when she next logs in. It starts with ${gradeLabel(reader.startLevel)} stories and moves up or down from there.`}</span>
        {reader.baseline && !confirm && <div><button className="link" type="button" onClick={() => setConfirm(true)}>Re-run reading check</button></div>}
        {confirm && (
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small">Next time she logs in she&rsquo;ll start with the check.</span>
            <button type="button" onClick={() => { void onRerunCheck(); setConfirm(false); }}>Yes, re-run</button>
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

const LISTENER_LABEL: Record<AzureDetail["listener"], string> = { azure: "Azure", browser: "Safari/Chrome", mixed: "Azure, then Safari/Chrome" };
const STATUS_LABEL: Record<string, string> = { miss: "misread", skip: "skipped", help: "helped" };

/** Plays slices of a session's recording: one shared audio element per session, fetched on the first tap. */
function useReadPlayer(sessionId: string, has: boolean) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<Promise<string> | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const stop = useCallback(() => { audio.current?.pause(); setPlaying(null); }, []);
  const play = useCallback(async (key: string, from: number, to: number | null) => {
    if (!has) return;
    try {
      url.current ??= recordingUrl(sessionId);
      const src = await url.current;
      let a = audio.current;
      if (!a) { a = new Audio(src); a.preload = "auto"; audio.current = a; }
      a.pause();
      a.ontimeupdate = to == null ? null : () => { if (a!.currentTime >= to) { a!.pause(); setPlaying(null); } };
      a.onended = () => setPlaying(null);
      a.currentTime = Math.max(0, from);
      await a.play();
      setPlaying(key);
      setErr("");
    } catch (e) {
      setPlaying(null);
      setErr(e instanceof Error ? e.message : "Couldn't play the recording.");
    }
  }, [sessionId, has]);
  return { play, stop, playing, err };
}

/** A word with a play button when the recording has its time. */
function WordChip({ w, i, player }: { w: AzureDetail["words"][number]; i: number; player: ReturnType<typeof useReadPlayer> }) {
  const key = `${i}`;
  const heard = w.h ? `, heard "${w.h}"` : "";
  const label = `${w.w}${w.s !== "ok" && STATUS_LABEL[w.s] ? ` (${STATUS_LABEL[w.s]}${w.a != null ? ` ${w.a}` : ""}${heard})` : w.a != null ? ` (${w.a}${heard})` : ""}`;
  if (w.t == null) return <span>{label}</span>;
  const on = player.playing === key;
  return (
    <button type="button" className="link" style={{ padding: "0 .2em", textDecoration: "none", color: on ? "var(--accent)" : "inherit" }}
      title="Hear how she said it" onClick={() => (on ? player.stop() : void player.play(key, w.t! - 0.3, w.t! + (w.d ?? 0.6) + 0.45))}>
      {on ? "◼" : "▶"} {label}
    </button>
  );
}

/** What the listener heard for one session: the words that were not read right, with Azure's score, any words she
 *  added, and, when the read was recorded, a play button on each word. */
function HeardDetail({ d, sessionId }: { d: AzureDetail; sessionId: string }) {
  const flagged = d.words.map((w, i) => ({ w, i })).filter(({ w }) => w.s === "miss" || w.s === "skip" || w.s === "help");
  const scored = d.words.filter((w) => w.a != null);
  const lowOk = d.words.map((w, i) => ({ w, i })).filter(({ w }) => w.s === "ok" && w.a != null && w.a < 80);
  const player = useReadPlayer(sessionId, !!d.recording);
  const list = (xs: { w: AzureDetail["words"][number]; i: number }[]) => xs.map(({ w, i }, k) => <span key={i}>{k ? ", " : ""}<WordChip w={w} i={i} player={player} /></span>);
  return (
    <details className="small muted">
      <summary>
        {d.scores ? `Azure: pronunciation ${d.scores.accuracy}, fluency ${d.scores.fluency}, completeness ${d.scores.completeness}%. ` : "No Azure scores. "}
        {flagged.length} flagged, {d.inserted.length} added{d.listener === "browser" ? "; words said wrong could not be checked" : ""}{d.recording ? "; recorded" : ""}.
      </summary>
      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
        {flagged.length > 0 && <div><b>Flagged:</b> {list(flagged)}</div>}
        {d.inserted.length > 0 && <div><b>Added words:</b> {d.inserted.join(", ")}</div>}
        {lowOk.length > 0 && <div><b>Passed with a low score (under 80):</b> {list(lowOk)}</div>}
        {scored.length > 0 && <div>{scored.length} words scored by Azure, median {median(scored.map((w) => w.a as number))}.</div>}
        {d.recording ? (
          <div>
            <button type="button" className="link" style={{ padding: 0 }} onClick={() => (player.playing === "all" ? player.stop() : void player.play("all", 0, null))}>
              {player.playing === "all" ? "◼ Stop" : "▶ Play the whole read"}{d.recording.seconds ? ` (${Math.round(d.recording.seconds)} s)` : ""}
            </button>
            <span> · tap a word above to hear just that word · recordings are kept for 30 days</span>
            {player.err && <span className="err"> {player.err}</span>}
          </div>
        ) : d.listener !== "browser" && <div>No recording for this read.</div>}
      </div>
    </details>
  );
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function SessionsTable({ reader }: { reader: Reader }) {
  const rows = reader.sessions.slice().reverse().slice(0, 40);
  return (
    <section className="card">
      <h3>Sessions</h3>
      <div className="scroll" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Story</th><th>Level</th><th>Words/min</th><th>Accuracy</th><th>Questions</th><th>Helped</th><th>Heard by</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{fmtDate(s.date)}</td>
                  <td>{s.title}{s.mode === "check" ? " (check)" : ""}</td>
                  <td>{gradeLabel(s.level)}</td>
                  <td>{s.wcpm ?? "–"}</td>
                  <td>{s.acc}%</td>
                  <td>{s.comp}/{s.compTotal}</td>
                  <td>{s.helps}</td>
                  <td>{s.azure ? LISTENER_LABEL[s.azure.listener] : "–"}</td>
                </tr>
                {s.azure && (
                  <tr>
                    <td colSpan={8} style={{ paddingTop: 0 }}><HeardDetail d={s.azure} sessionId={s.id} /></td>
                  </tr>
                )}
              </Fragment>
            )) : <tr><td colSpan={8} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Settings({ reader, app }: { reader: Reader; app: AppActions }) {
  const [goal, setGoal] = useState(String(reader.goal));
  const [reward, setReward] = useState(String(reader.reward));
  const [rewardKind, setRewardKind] = useState<RewardKind>(reader.rewardKind);
  const [rewardLabel, setRewardLabel] = useState(reader.rewardLabel);
  const [interests, setInterests] = useState(reader.interests);
  const [level, setLevel] = useState(String(reader.level));
  const [startLevel, setStartLevel] = useState(String(reader.startLevel));
  const [readerPin, setReaderPin] = useState("");
  const [newParentPin, setNewParentPin] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setMsg("");
    if (readerPin && !isValidPin(readerPin)) return setErr("The reader PIN needs to be 4 digits.");
    if (newParentPin && !isValidPin(newParentPin)) return setErr("The parent PIN needs to be 4 digits.");
    if (readerPin && newParentPin && readerPin === newParentPin) return setErr("Use a different PIN for the parent.");
    const clamp = (v: string, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, +v || dflt));
    setBusy(true);
    // The server checks the new PIN against the stored ones (parent vs. reader, sister vs. sister).
    const problem = await app.saveSettings(reader.id, {
      goal: clamp(goal, 1, 14, 5),
      reward: clamp(reward, 1, 100, 5),
      rewardKind,
      rewardLabel: rewardLabel.trim(),
      interests: interests.trim(),
      level: clamp(level, MIN_LEVEL, MAX_LEVEL, reader.level),
      startLevel: clamp(startLevel, MIN_LEVEL, MAX_LEVEL, reader.startLevel),
    }, { readerPin: readerPin || undefined, parentPin: newParentPin || undefined });
    setBusy(false);
    if (problem) return setErr(problem);
    setReaderPin("");
    setNewParentPin("");
    setMsg("Saved.");
  }

  async function erase() {
    setErasing(true);
    try {
      await app.eraseAll();
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't erase.");
      setErasing(false);
      setConfirmErase(false);
    }
  }

  return (
    <section className="card stack">
      <h3>Settings for {reader.name}</h3>
      <form className="grid2" autoComplete="off" onSubmit={submit}>
        <label className="field"><span className="label">Stories per week</span><input type="number" min={1} max={14} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <RewardChoice kind={rewardKind} amount={reward} label={rewardLabel} onKind={setRewardKind} onAmount={setReward} onLabel={setRewardLabel} />
        <label className="field span-all"><span className="label">Her interests (for new stories)</span><input type="text" value={interests} onChange={(e) => setInterests(e.target.value)} /></label>
        <label className="field"><span className="label">Reading level (1–7)</span><input type="number" min={MIN_LEVEL} max={MAX_LEVEL} value={level} onChange={(e) => setLevel(e.target.value)} /></label>
        <label className="field"><span className="label">Reading check starts at level (1–7)</span><input type="number" min={MIN_LEVEL} max={MAX_LEVEL} value={startLevel} onChange={(e) => setStartLevel(e.target.value)} /></label>
        <label className="field"><span className="label">New PIN for {reader.name} (leave blank to keep)</span><input type="password" inputMode="numeric" maxLength={4} value={readerPin} onChange={(e) => setReaderPin(e.target.value)} /></label>
        <label className="field"><span className="label">New parent PIN (leave blank to keep)</span><input type="password" inputMode="numeric" maxLength={4} value={newParentPin} onChange={(e) => setNewParentPin(e.target.value)} /></label>
        <div className="row span-all">
          <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          <span className="muted">{msg}</span>
          <span className="err">{err}</span>
        </div>
      </form>
      <div className="row">
        {!confirmErase && <button className="link" type="button" onClick={() => setConfirmErase(true)}>Erase all progress for both girls</button>}
        {confirmErase && (
          <span className="row">
            <b className="err">Erase every session, tricky word and reward for both girls, on every device? PINs stay.</b>
            <button className="danger" type="button" disabled={erasing} onClick={() => void erase()}>{erasing ? "Erasing…" : "Yes, erase"}</button>
            <button className="link" type="button" onClick={() => setConfirmErase(false)}>Cancel</button>
          </span>
        )}
      </div>
    </section>
  );
}

/** Cash (an amount) or something else (a named prize). Used by the parent settings and first-run setup. */
export function RewardChoice({ kind, amount, label, onKind, onAmount, onLabel }: {
  kind: RewardKind;
  amount: string;
  label: string;
  onKind: (k: RewardKind) => void;
  onAmount: (v: string) => void;
  onLabel: (v: string) => void;
}) {
  return (
    <div className="field">
      <span className="label">Weekly reward</span>
      <div className="choices">
        <label className="radio"><input type="radio" name="reward-kind" checked={kind === "cash"} onChange={() => onKind("cash")} /> Cash</label>
        {kind === "cash" && (
          <label className="field"><span className="label">Amount ($)</span><input type="number" min={1} max={100} value={amount} onChange={(e) => onAmount(e.target.value)} /></label>
        )}
        <label className="radio"><input type="radio" name="reward-kind" checked={kind === "prize"} onChange={() => onKind("prize")} /> Something else</label>
        {kind === "prize" && (
          <label className="field"><span className="label">What&rsquo;s the prize?</span><input type="text" placeholder="e.g. a trip to the bookstore" value={label} onChange={(e) => onLabel(e.target.value)} /></label>
        )}
      </div>
    </div>
  );
}
