"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearState, defaultState, loadState, saveState, type AppState } from "@/lib/store";

/** Loads app state from localStorage after mount, and persists every update. */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const ref = useRef<AppState | null>(null);

  useEffect(() => {
    const s = loadState();
    ref.current = s;
    setState(s);
  }, []);

  /** Apply a mutation to a copy of the state, save it, and re-render. Synchronous: `getState()` sees it at once. */
  const update = useCallback((fn: (draft: AppState) => void) => {
    const base = ref.current ?? loadState();
    const next = JSON.parse(JSON.stringify(base)) as AppState;
    fn(next);
    ref.current = next;
    saveState(next);
    setState(next);
  }, []);

  const reset = useCallback(() => {
    clearState();
    const s = defaultState();
    ref.current = s;
    setState(s);
  }, []);

  const getState = useCallback(() => ref.current, []);

  return { state, update, reset, getState };
}
