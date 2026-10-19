"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SetupData } from "@/components/screens/SetupScreen";
import { clearBaseline, eraseProgress, errorMessage, loadAppState, markWeeksPaid, recordTroubleWords, saveSessionRemote, setPins, updateReaderFields, type ReaderFields } from "@/lib/data";
import { planSessionSave, type SaveSessionResult, type SessionPayload } from "@/lib/sessionSave";
import type { AppState, SessionRec } from "@/lib/store";

const REFRESH_GAP_MS = 10_000;

/**
 * Loads the signed-in parent's data from Supabase after mount, re-fetches when the tab comes back into
 * view (so progress made on the iPad shows up on the phone), and exposes the writes the screens need.
 * Every write goes to the server first and is then mirrored into local state, so `getState()` is
 * current as soon as the promise resolves.
 */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<AppState | null>(null);
  const lastLoad = useRef(0);

  const set = useCallback((s: AppState) => {
    ref.current = s;
    setState(s);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await loadAppState();
      lastLoad.current = Date.now();
      set(s);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [set]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const maybe = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoad.current < REFRESH_GAP_MS) return;
      void refresh();
    };
    document.addEventListener("visibilitychange", maybe);
    window.addEventListener("focus", maybe);
    return () => {
      document.removeEventListener("visibilitychange", maybe);
      window.removeEventListener("focus", maybe);
    };
  }, [refresh]);

  /** Change local state only (after the server write has succeeded). */
  const apply = useCallback((fn: (draft: AppState) => void) => {
    const base = ref.current;
    if (!base) return;
    const next = JSON.parse(JSON.stringify(base)) as AppState;
    fn(next);
    set(next);
  }, [set]);

  const getState = useCallback(() => ref.current, []);

  /** First-run setup: PINs (hashed server-side), interests, goal and reward. Returns an error message or null. */
  const saveSetup = useCallback(async (d: SetupData): Promise<string | null> => {
    try {
      await setPins({ parentPin: d.parentPin, readers: d.readers.map((r) => ({ id: r.id, pin: r.pin })) });
      await Promise.all(d.readers.map((r) => updateReaderFields(r.id, { interests: r.interests, goal: d.goal, reward: d.reward, rewardKind: d.rewardKind, rewardLabel: d.rewardLabel })));
    } catch (e) {
      return errorMessage(e);
    }
    apply((s) => {
      s.parentPinSet = true;
      for (const r of s.readers) {
        const x = d.readers.find((y) => y.id === r.id);
        if (!x) continue;
        r.pinSet = true;
        r.interests = x.interests;
        r.goal = d.goal;
        r.reward = d.reward;
        r.rewardKind = d.rewardKind;
        r.rewardLabel = d.rewardLabel;
      }
    });
    return null;
  }, [apply]);

  /** Parent settings for one reader, plus optional new PINs. Returns an error message or null. */
  const saveSettings = useCallback(async (readerId: string, fields: ReaderFields, pins: { readerPin?: string; parentPin?: string }): Promise<string | null> => {
    try {
      if (pins.readerPin || pins.parentPin) {
        await setPins({ parentPin: pins.parentPin || undefined, readers: pins.readerPin ? [{ id: readerId, pin: pins.readerPin }] : undefined });
      }
      await updateReaderFields(readerId, fields);
    } catch (e) {
      return errorMessage(e);
    }
    apply((s) => {
      if (pins.parentPin) s.parentPinSet = true;
      const r = s.readers.find((x) => x.id === readerId);
      if (!r) return;
      if (pins.readerPin) r.pinSet = true;
      if (fields.interests !== undefined) r.interests = fields.interests;
      if (fields.level !== undefined) r.level = fields.level;
      if (fields.startLevel !== undefined) r.startLevel = fields.startLevel;
      if (fields.goal !== undefined) r.goal = fields.goal;
      if (fields.reward !== undefined) r.reward = fields.reward;
      if (fields.rewardKind !== undefined) r.rewardKind = fields.rewardKind;
      if (fields.rewardLabel !== undefined) r.rewardLabel = fields.rewardLabel.trim();
    });
    return null;
  }, [apply]);

  const markPaid = useCallback(async (readerId: string, weeks: string[]) => {
    const now = new Date();
    await markWeeksPaid(readerId, weeks, now);
    apply((s) => {
      const r = s.readers.find((x) => x.id === readerId);
      if (r) for (const w of weeks) r.paidWeeks[w] = now.toISOString();
    });
  }, [apply]);

  const rerunCheck = useCallback(async (readerId: string) => {
    await clearBaseline(readerId);
    apply((s) => { const r = s.readers.find((x) => x.id === readerId); if (r) r.baseline = null; });
  }, [apply]);

  /** misses++ / wins++ outside a saved session (tricky-word practice, or a story that was too short to save). */
  const recordWords = useCallback(async (readerId: string, missed: string[], won: string[]) => {
    try {
      await recordTroubleWords(readerId, missed, won);
    } catch {
      return; // not worth interrupting her for
    }
    apply((s) => {
      const r = s.readers.find((x) => x.id === readerId);
      if (!r) return;
      for (const w of missed) { const t = r.trouble[w] ?? (r.trouble[w] = { miss: 0, win: 0 }); t.miss++; }
      for (const w of won) { const t = r.trouble[w] ?? (r.trouble[w] = { miss: 0, win: 0 }); t.win++; }
    });
  }, [apply]);

  /**
   * Save a finished session through POST /api/sessions. If the save fails (offline, say), the same rules
   * run locally so she still sees her results; `saved` is false and the session is gone on the next load.
   */
  const saveSession = useCallback(async (payload: SessionPayload, meta: { title: string; level: number }): Promise<SaveSessionResult> => {
    let res: SaveSessionResult;
    try {
      res = await saveSessionRemote(payload);
    } catch {
      const r = ref.current?.readers.find((x) => x.id === payload.readerId);
      const plan = planSessionSave(payload, { level: r?.level ?? 3, weeklyGoal: r?.goal ?? 5 }, (r?.sessions ?? []).filter((s) => s.counts).map((s) => s.date));
      res = {
        saved: false, sessionId: `unsaved-${Date.now()}`, endedAt: payload.endedAt, stars: plan.stars, counts: plan.counts,
        levelBefore: plan.levelBefore, level: plan.level, countedBefore: plan.countedBefore, countedAfter: plan.countedAfter, goalCrossed: plan.goalCrossed,
        baseline: plan.baseline ? { id: `unsaved-${Date.now()}`, date: payload.endedAt, level: plan.baseline.level, wcpm: plan.baseline.wcpm, ids: plan.baseline.passage_ids } : null,
      };
    }
    const rec: SessionRec = {
      id: res.sessionId, date: res.endedAt, mode: payload.mode, passageId: payload.passageId, title: meta.title, level: meta.level,
      wcpm: payload.wcpm, acc: Math.round(payload.accuracy * 100), comp: payload.compRight, compTotal: payload.compTotal,
      missed: payload.missedWords, helps: payload.helpedWords.length, counts: res.counts, stars: res.stars,
    };
    apply((s) => {
      const r = s.readers.find((x) => x.id === payload.readerId);
      if (!r) return;
      r.sessions.push(rec);
      r.stars += res.stars;
      r.level = res.level;
      if (res.baseline) r.baseline = res.baseline;
      for (const w of payload.missedWords) { const t = r.trouble[w] ?? (r.trouble[w] = { miss: 0, win: 0 }); t.miss++; }
      for (const w of payload.wonWords) { const t = r.trouble[w] ?? (r.trouble[w] = { miss: 0, win: 0 }); t.win++; }
    });
    return res;
  }, [apply]);

  /** Erase both girls' progress everywhere. PINs and interests stay. */
  const eraseAll = useCallback(async () => {
    const s = ref.current;
    if (!s) return;
    await eraseProgress(s.readers.map((r) => ({ id: r.id, startLevel: r.startLevel })));
    await refresh();
  }, [refresh]);

  return { state, error, refresh, getState, apply, saveSetup, saveSettings, markPaid, rerunCheck, recordWords, saveSession, eraseAll };
}

export type AppActions = ReturnType<typeof useAppState>;
