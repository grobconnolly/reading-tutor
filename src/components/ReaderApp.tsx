"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CoachBar } from "@/components/CoachBar";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { QuizScreen } from "@/components/screens/QuizScreen";
import { ReadScreen } from "@/components/screens/ReadScreen";
import { ResultsScreen, type ResultsView } from "@/components/screens/ResultsScreen";
import { SetupScreen, type SetupData } from "@/components/screens/SetupScreen";
import { WordPracticeScreen } from "@/components/screens/WordPracticeScreen";
import { useAppState } from "@/hooks/useAppState";
import { useCoach } from "@/hooks/useCoach";
import { checkPassageFor, type Passage } from "@/lib/passages";
import { checkFinalLevel, checkPassed, nextCheckLevel, nextLevelAfterPractice, RULES, sessionCounts, starsFor, type CheckState, type ReadResult } from "@/lib/scoring";
import { hasSR } from "@/lib/speech";
import { countedThisWeek, isSetupComplete, newId, PARENT_UNLOCK_KEY, pickPassage, streak, trickyWords, type Reader, type SessionRec } from "@/lib/store";

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
}

const DEFAULT_INTRO = "Tap start reading, then read the story out loud. If you get stuck, I'll help.";
const COACH_SCREENS = new Set(["home", "read", "words", "quiz", "results"]);

/** The reader's whole experience: login, home, read, word practice, quiz, results. One state machine, as in version 1. */
export function ReaderApp() {
  const router = useRouter();
  const { state, update, getState } = useAppState();
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
  const updReader = (fn: (r: Reader) => void) => {
    update((d) => { const r = d.readers.find((x) => x.id === readerIdRef.current); if (r) fn(r); });
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
      : won ? `Hi ${r.name}! You already earned your ${r.reward} dollars this week. Keep reading to get even stronger!`
      : `Hi ${r.name}! ${left} more ${left === 1 ? "story" : "stories"} this week to earn ${r.reward} dollars.`,
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
    flow.current = { mode: "practice", passage: p };
    openReading(p, timesRead >= 1 ? "Read it again. Rereading makes you faster." : "");
  }

  function startCheck() {
    const r = cur();
    if (!r) return;
    flow.current = { mode: "check", check: { tested: {}, count: 0, ids: [], current: r.startLevel } };
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
    updReader((r) => {
      for (const w of result.missed) {
        const t = r.trouble[w] ?? (r.trouble[w] = { miss: 0, win: 0 });
        t.miss++;
      }
    });
    void afterReading();
  }

  async function afterReading() {
    const f = flow.current!;
    const r = f.result!;
    if (r.finishedPct < RULES.minFinishToSave) {
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
    updReader((r) => {
      const t = r.trouble[word] ?? (r.trouble[word] = { miss: 0, win: 0 });
      t.win++;
    });
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
    flow.current = { mode: "tricky" };
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
    const counts = sessionCounts(r.finishedPct);
    const before = countedThisWeek(rd);
    const stars = starsFor(r.acc, comp, compTotal);
    const mode = f.mode === "check" ? "check" : "practice";
    const sess: SessionRec = {
      id: newId(), date: new Date().toISOString(), mode, passageId: f.passage!.id, title: f.passage!.title, level: f.passage!.level,
      wcpm: r.wcpm, acc: Math.round(r.acc * 100), comp, compTotal, missed: r.missed, helps: r.helps, counts, stars,
    };
    const newLevel = mode === "practice" ? nextLevelAfterPractice(rd.level, r.acc, comp, compTotal) : rd.level;
    const levelMsg: "up" | "down" | "" = newLevel > rd.level ? "up" : newLevel < rd.level ? "down" : "";
    updReader((x) => {
      x.sessions.push(sess);
      x.stars += stars;
      x.level = newLevel;
    });
    const stats = { stars, wcpm: sess.wcpm, acc: sess.acc, comp, compTotal };

    if (f.mode === "check") {
      const ck = f.check!;
      ck.count++;
      const L = ck.current;
      const pass = checkPassed(r.acc, comp);
      ck.tested[L] = pass;
      ck.ids.push(f.passage!.id);
      const next = nextCheckLevel(ck.tested, L, pass, ck.count);
      if (next != null) {
        setScreen({ name: "results", view: { kicker: "Reading check", title: `Story ${ck.count} done!`, ...stats, nextLabel: "Next story", onNext: () => nextCheckPassage(next, false) } });
        await coach.say("Great job. Let's try one more story.");
        return;
      }
      const lvl = checkFinalLevel(ck.tested);
      updReader((x) => {
        x.level = lvl;
        x.baseline = { date: new Date().toISOString(), level: lvl, wcpm: sess.wcpm, ids: ck.ids };
      });
      setScreen({ name: "results", view: { kicker: "Reading check done", title: "You finished the reading check!", ...stats, nextLabel: "Read a story", onNext: startPractice } });
      await coach.say("You finished the reading check! Now I know which stories are just right for you.");
      await goalCheck(before);
      return;
    }

    const n = cur()!.sessions.length;
    setScreen({ name: "results", view: { kicker: "Nice work", title: ["You finished the story!", "Story complete!", "Way to go!"][n % 3], ...stats, nextLabel: "Read another", onNext: startPractice } });
    let line = stars === 3 ? "Three stars! Amazing." : stars === 2 ? "Two stars! Great job." : "You earned a star for finishing.";
    if (levelMsg === "up") line += " You're ready for harder stories. Level up!";
    await coach.say(line);
    if (!counts) coach.bubble("Read at least most of the story for it to count toward your goal.");
    await goalCheck(before);
    // Milestone 5: ask /api/coach-note for two sentences of praise and a tip, and show them in the note.
  }

  async function goalCheck(before: number) {
    const r = cur();
    if (!r) return;
    const after = countedThisWeek(r);
    if (before < r.goal && after >= r.goal) {
      await coach.say(`You hit your weekly goal! You earned ${r.reward} dollars!`);
    } else if (after < r.goal && after > before) {
      const left = r.goal - after;
      await coach.say(`${left} more ${left === 1 ? "story" : "stories"} this week to earn ${r.reward} dollars.`);
    }
  }

  /* ---------- login / setup ---------- */

  function loginReader(id: string, pin: string): boolean {
    const r = getState()?.readers.find((x) => x.id === id);
    if (!r || !r.pin || r.pin !== pin) return false;
    readerIdRef.current = id;
    setReaderId(id);
    goHome();
    return true;
  }

  function loginParent(pin: string): boolean {
    const s = getState();
    if (!s?.parentPin || s.parentPin !== pin) return false;
    try { sessionStorage.setItem(PARENT_UNLOCK_KEY, "1"); } catch { /* ignore */ }
    router.push("/parent");
    return true;
  }

  function logout() {
    coach.cancel();
    flow.current = null;
    readerIdRef.current = null;
    setReaderId(null);
    setScreen({ name: "login" });
  }

  function onSetup(d: SetupData) {
    update((s) => {
      s.parentPin = d.parentPin;
      for (const r of s.readers) {
        const x = d.readers.find((y) => y.id === r.id);
        if (!x) continue;
        r.pin = x.pin;
        r.interests = x.interests;
        r.goal = d.goal;
        r.reward = d.reward;
      }
    });
    setScreen({ name: "login" });
  }

  /* ---------- render ---------- */

  if (!state || screen.name === "loading") {
    return <main className="wrap"><p className="muted">Loading…</p></main>;
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
