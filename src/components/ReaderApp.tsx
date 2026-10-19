"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CoachBar } from "@/components/CoachBar";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { LoginScreen, type LoginResult } from "@/components/screens/LoginScreen";
import { QuizScreen } from "@/components/screens/QuizScreen";
import { ReadScreen } from "@/components/screens/ReadScreen";
import { ResultsScreen, type ResultsView } from "@/components/screens/ResultsScreen";
import { SetupScreen, type SetupData } from "@/components/screens/SetupScreen";
import { WordPracticeScreen } from "@/components/screens/WordPracticeScreen";
import { useAppState } from "@/hooks/useAppState";
import { useCoach } from "@/hooks/useCoach";
import { verifyPin } from "@/lib/data";
import { checkPassageFor, type Passage } from "@/lib/passages";
import { alreadyEarnedGreeting, goalHitLine, moreStoriesLine } from "@/lib/reward";
import { checkPassed, nextCheckLevel, RULES, type CheckState, type ReadResult } from "@/lib/scoring";
import type { SaveSessionResult, SessionPayload } from "@/lib/sessionSave";
import { hasSR } from "@/lib/speech";
import { countedThisWeek, isSetupComplete, PARENT_UNLOCK_KEY, pickPassage, streak, trickyWords, type Reader } from "@/lib/store";

type Screen =
  | { name: "loading" }
  | { name: "setup" }
  | { name: "login" }
  | { name: "home" }
  | { name: "read"; passage: Passage; mode: "check" | "practice"; kicker: string; intro: string }
  | { name: "words"; list: string[]; intro: string }
  | { name: "quiz"; passage: Passage }
  | { name: "results"; view: ResultsView };

interface Flow {
  mode: "check" | "practice" | "tricky";
  passage?: Passage;
  result?: ReadResult;
  check?: CheckState;
  /** Words she passed in word practice this session (wins++ when the session is saved). */
  won: string[];
}

const DEFAULT_INTRO = "Tap start reading, then read the story out loud. If you get stuck, I'll help.";
const COACH_SCREENS = new Set(["home", "read", "words", "quiz", "results"]);
const UNSAVED_NOTE = "I couldn't save this story. Check the internet connection and try the next one.";

/** The reader's whole experience: login, home, read, word practice, quiz, results. One state machine, as in version 1. */
export function ReaderApp() {
  const router = useRouter();
  const { state, error, refresh, getState, saveSetup, recordWords, saveSession } = useAppState();
  const coach = useCoach();
  const [readerId, setReaderId] = useState<string | null>(null);
  const readerIdRef = useRef<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [readKey, setReadKey] = useState(0);
  const [wordsKey, setWordsKey] = useState(0);
  const flow = useRef<Flow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!state || screen.name !== "loading") return;
    setScreen(isSetupComplete(state) ? { name: "login" } : { name: "setup" });
  }, [state, screen.name]);

  useEffect(() => {
    if (!hasSR()) setBanner("Listening only works in Chrome, Edge, or Safari. Open this page in one of those.");
    else if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) setBanner("Tip for grown-ups: put this page on a website (https) so the microphone works smoothly.");
    else setBanner(null);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [screen.name]);

  /* ---------- helpers that always read live data ---------- */

  const cur = (): Reader | null => {
    const s = getState();
    return s?.readers.find((r) => r.id === readerIdRef.current) ?? null;
  };

  /* ---------- home ---------- */

  function goHome() {
    const r = cur();
    flow.current = null;
    if (!r) { setScreen({ name: "login" }); return; }
    setScreen({ name: "home" });
    const done = countedThisWeek(r);
    const won = done >= r.goal;
    const left = r.goal - done;
    coach.say(
      !r.baseline ? `Hi ${r.name}! I'm Coach Juno. First, let's do a quick reading check so I can find stories that are just right for you.`
      : won ? alreadyEarnedGreeting(r, r.name)
      : `Hi ${r.name}! ${moreStoriesLine(r, left)}`,
    );
  }

  /* ---------- reading ---------- */

  function openReading(p: Passage, intro: string) {
    const f = flow.current!;
    const mode = f.mode === "check" ? "check" : "practice";
    const kicker = mode === "check" ? `Reading check · story ${(f.check?.count ?? 0) + 1}` : "Read out loud";
    setReadKey((k) => k + 1);
    setScreen({ name: "read", passage: p, mode, kicker, intro: intro || DEFAULT_INTRO });
  }

  function startPractice() {
    const r = cur();
    if (!r) return;
    const { p, timesRead } = pickPassage(r);
    // Milestone 5: once every passage at her level has been read twice, ask /api/story for a new one.
    flow.current = { mode: "practice", passage: p, won: [] };
    openReading(p, timesRead >= 1 ? "Read it again. Rereading makes you faster." : "");
  }

  function startCheck() {
    const r = cur();
    if (!r) return;
    flow.current = { mode: "check", check: { tested: {}, count: 0, ids: [], current: r.startLevel }, won: [] };
    nextCheckPassage(r.startLevel, true);
  }

  function nextCheckPassage(level: number, first: boolean) {
    const f = flow.current!;
    const p = checkPassageFor(level);
    f.passage = p;
    f.check!.current = level;
    openReading(p, first ? "This is a reading check. Read this story out loud, the best you can. If you get stuck on a word, I'll help." : "Here's the next story.");
  }

  function onReadingFinished(result: ReadResult) {
    const f = flow.current!;
    f.result = result;
    f.won = [];
    void afterReading();
  }

  async function afterReading() {
    const f = flow.current!;
    const r = f.result!;
    if (r.finishedPct < RULES.minFinishToSave) {
      // Too short to save as a session, but the words she missed still count as tricky, as in version 1.
      if (r.missed.length && readerIdRef.current) void recordWords(readerIdRef.current, r.missed, []);
      await coach.say("Let's keep going next time. Every page counts!");
      goHome();
      return;
    }
    await coach.say(r.acc >= 0.95 ? "Wow, that was smooth reading!" : r.acc >= 0.9 ? "Nice reading! You worked hard on that." : "Good effort. That one had some tricky words.");
    if (f.mode !== "check" && r.missed.length) {
      setWordsKey((k) => k + 1);
      setScreen({ name: "words", list: r.missed.slice(0, 5), intro: "Let's practice a few words from the story." });
      return;
    }
    runQuiz();
  }

  /* ---------- word practice ---------- */

  function onWordResult(word: string, hit: boolean) {
    if (!hit) return;
    const f = flow.current;
    if (!f) return;
    if (f.mode === "tricky") {
      if (readerIdRef.current) void recordWords(readerIdRef.current, [], [word]);
    } else {
      f.won.push(word);
    }
  }

  async function onWordsDone(wins: number) {
    const f = flow.current;
    if (f?.mode === "tricky") {
      const n = screen.name === "words" ? screen.list.length : wins;
      await coach.say(`You got ${wins} out of ${n}. Great practice!`);
      goHome();
      return;
    }
    runQuiz();
  }

  function startTricky() {
    const r = cur();
    if (!r) return;
    const list = trickyWords(r, 8).map((t) => t.word);
    if (!list.length) {
      coach.say("No tricky words yet. Read a story and I'll save the hard ones here.");
      return;
    }
    flow.current = { mode: "tricky", won: [] };
    setWordsKey((k) => k + 1);
    setScreen({ name: "words", list, intro: "Let's practice your tricky words." });
  }

  /* ---------- quiz, results, leveling ---------- */

  function runQuiz() {
    setScreen({ name: "quiz", passage: flow.current!.passage! });
  }

  async function finishSession(comp: number, compTotal: number) {
    const f = flow.current!;
    const r = f.result!;
    const rd = cur()!;
    const p = f.passage!;
    const mode = f.mode === "check" ? "check" : "practice";

    // For a reading check, decide where the check goes next before saving, so the server can
    // record the final level and baseline on the last story.
    let next: number | null = null;
    if (f.mode === "check") {
      const ck = f.check!;
      ck.count++;
      const pass = checkPassed(r.acc, comp);
      ck.tested[ck.current] = pass;
      ck.ids.push(p.id);
      next = nextCheckLevel(ck.tested, ck.current, pass, ck.count);
    }

    const endedAt = r.endedAt ?? Date.now();
    const payload: SessionPayload = {
      readerId: rd.id, mode, passageId: p.id,
      startedAt: new Date(r.startedAt ?? endedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
      wordsTotal: r.total, wordsAttempted: r.attempted, wordsCorrect: r.ok, accuracy: r.acc, wcpm: r.wcpm,
      compRight: comp, compTotal, helpedWords: r.helped, missedWords: r.missed, wonWords: f.won, finishedPct: r.finishedPct,
      check: f.mode === "check" ? { tested: f.check!.tested, ids: f.check!.ids, done: next == null } : undefined,
    };
    // Saves the session, bumps trouble words, recomputes the level and the reward week on the server.
    const res = await saveSession(payload, { title: p.title, level: p.level });
    const note = res.saved ? null : UNSAVED_NOTE;
    const stats = { stars: res.stars, wcpm: r.wcpm, acc: Math.round(r.acc * 100), comp, compTotal, note };
    const levelMsg: "up" | "down" | "" = res.level > res.levelBefore ? "up" : res.level < res.levelBefore ? "down" : "";

    if (f.mode === "check") {
      const ck = f.check!;
      if (next != null) {
        const goTo = next;
        setScreen({ name: "results", view: { kicker: "Reading check", title: `Story ${ck.count} done!`, ...stats, nextLabel: "Next story", onNext: () => nextCheckPassage(goTo, false) } });
        await coach.say("Great job. Let's try one more story.");
        return;
      }
      setScreen({ name: "results", view: { kicker: "Reading check done", title: "You finished the reading check!", ...stats, nextLabel: "Read a story", onNext: startPractice } });
      await coach.say("You finished the reading check! Now I know which stories are just right for you.");
      await goalCheck(res);
      return;
    }

    const n = cur()!.sessions.length;
    setScreen({ name: "results", view: { kicker: "Nice work", title: ["You finished the story!", "Story complete!", "Way to go!"][n % 3], ...stats, nextLabel: "Read another", onNext: startPractice } });
    let line = res.stars === 3 ? "Three stars! Amazing." : res.stars === 2 ? "Two stars! Great job." : "You earned a star for finishing.";
    if (levelMsg === "up") line += " You're ready for harder stories. Level up!";
    await coach.say(line);
    if (!res.counts) coach.bubble("Read at least most of the story for it to count toward your goal.");
    await goalCheck(res);
    // Milestone 5: ask /api/coach-note for two sentences of praise and a tip, and show them in the note.
  }

  async function goalCheck(res: SaveSessionResult) {
    const r = cur();
    if (!r) return;
    if (res.goalCrossed) {
      await coach.say(goalHitLine(r));
    } else if (res.countedAfter < r.goal && res.countedAfter > res.countedBefore) {
      await coach.say(moreStoriesLine(r, r.goal - res.countedAfter));
    }
  }

  /* ---------- login / setup ---------- */

  async function loginReader(id: string, pin: string): Promise<LoginResult> {
    const res = await verifyPin(id, pin);
    if (!res.ok) return res;
    readerIdRef.current = id;
    setReaderId(id);
    goHome();
    return { ok: true };
  }

  async function loginParent(pin: string): Promise<LoginResult> {
    const res = await verifyPin("parent", pin);
    if (!res.ok) return res;
    try { sessionStorage.setItem(PARENT_UNLOCK_KEY, "1"); } catch { /* ignore */ }
    router.push("/parent");
    return { ok: true };
  }

  function logout() {
    coach.cancel();
    flow.current = null;
    readerIdRef.current = null;
    setReaderId(null);
    setScreen({ name: "login" });
    void refresh();
  }

  async function onSetup(d: SetupData): Promise<string | null> {
    const err = await saveSetup(d);
    if (err) return err;
    setScreen({ name: "login" });
    return null;
  }

  /* ---------- render ---------- */

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
  if (!state || screen.name === "loading") {
    return <main className="wrap"><p className="muted">Loading…</p></main>;
  }
  if (!state.readers.length) {
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
  const reader = state.readers.find((r) => r.id === readerId) ?? null;

  return (
    <main className="wrap">
      {COACH_SCREENS.has(screen.name) && <CoachBar coach={coach} />}
      {screen.name === "setup" && <SetupScreen readers={state.readers} onSave={onSetup} />}
      {screen.name === "login" && <LoginScreen readers={state.readers} onReader={loginReader} onParent={loginParent} />}
      {screen.name === "home" && reader && (
        <HomeScreen reader={reader} done={countedThisWeek(reader)} streak={streak(reader)} banner={banner}
          onCheck={startCheck} onPractice={startPractice} onTricky={startTricky} onLogout={logout} />
      )}
      {screen.name === "read" && (
        <ReadScreen key={readKey} coach={coach} passage={screen.passage} mode={screen.mode} kicker={screen.kicker} intro={screen.intro}
          onFinish={onReadingFinished} onQuit={goHome} />
      )}
      {screen.name === "words" && (
        <WordPracticeScreen key={wordsKey} coach={coach} list={screen.list} intro={screen.intro} onResult={onWordResult} onDone={onWordsDone} />
      )}
      {screen.name === "quiz" && <QuizScreen key={screen.passage.id + readKey} coach={coach} passage={screen.passage} onDone={finishSession} />}
      {screen.name === "results" && <ResultsScreen view={screen.view} onHome={goHome} />}
    </main>
  );
}
