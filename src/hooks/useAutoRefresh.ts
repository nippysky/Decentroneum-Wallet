// src/hooks/useAutoRefresh.ts
//
// Keeps a screen's data live without the user having to do anything.
//
// Pull-to-refresh should be a reassurance gesture, not a requirement — if
// someone has to yank the screen down after every transaction to see the
// truth, the app feels broken even when it isn't. This hook makes fresh
// data the default and leaves pull-to-refresh as the manual override.
//
// It is deliberately conservative about *when* it polls, because every
// poll is an RPC call on someone's mobile data:
//   • only while the screen is actually focused
//   • only while the app is in the foreground
//   • immediately on regaining focus/foreground (that's the moment stale
//     data is most visible), then on a steady interval
//   • never overlapping — a slow request won't stack up behind itself
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
// Must come from expo-router, NOT @react-navigation/native: as of Expo SDK
// 56 expo-router refuses to bundle alongside react-navigation and Metro
// fails the build outright. expo-router re-exports useFocusEffect for
// exactly this reason.
import { useFocusEffect } from "expo-router";

export type AutoRefreshOptions = {
  /** How often to re-poll while focused + foregrounded. */
  intervalMs?: number;
  /** Set false to suspend polling (e.g. no wallet address yet). */
  enabled?: boolean;
  /** Extra one-shot catch-up delays, for chain/indexer lag after a tx. */
  catchUpDelaysMs?: number[];
  /**
   * Refresh immediately whenever this value changes.
   *
   * Pass the active wallet address: switching accounts changes what the
   * screen is *about*, so waiting for the next poll tick would leave the
   * previous account's balances on screen for up to `intervalMs`. This makes
   * the switch feel instant instead of eventually-correct.
   */
  refreshKey?: string | number | null;
};

const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_CATCHUP = [6_000, 15_000];

export function useAutoRefresh(
  refresh: () => Promise<void> | void,
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
    catchUpDelaysMs = DEFAULT_CATCHUP,
    refreshKey = null,
  }: AutoRefreshOptions = {}
) {
  // Keep the latest callback in a ref so the polling timers never capture a
  // stale closure, without making every timer restart on each render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const inFlightRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusedRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  /** Never let two refreshes overlap — the second would just queue up
   *  behind the first and land as a burst of duplicate RPC calls. */
  const runSafely = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await refreshRef.current();
    } catch {
      // Auto-refresh is background work — a failure here must stay silent
      // and must never leave a spinner up. Manual refresh surfaces errors.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  /** Refresh now, then again after each catch-up delay. Used after a send,
   *  where the node may not have indexed the new balance yet. */
  const refreshWithCatchUp = useCallback(() => {
    runSafely();
    clearTimers();
    for (const delay of catchUpDelaysMs) {
      timersRef.current.push(setTimeout(() => runSafely(), delay));
    }
  }, [runSafely, clearTimers, catchUpDelaysMs]);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      if (focusedRef.current && AppState.currentState === "active") runSafely();
    }, intervalMs);
  }, [intervalMs, runSafely]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Foreground/background: poll only while visible, and refresh instantly
  // on return — coming back to a stale balance is the worst-feeling case.
  useEffect(() => {
    if (!enabled) return;

    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      const returned = previous !== "active" && next === "active";
      if (returned && focusedRef.current) refreshWithCatchUp();
      previous = next;
    });

    return () => sub.remove();
  }, [enabled, refreshWithCatchUp]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;

      focusedRef.current = true;
      refreshWithCatchUp();
      startInterval();

      return () => {
        focusedRef.current = false;
        stopInterval();
        clearTimers();
      };
    }, [enabled, refreshWithCatchUp, startInterval, stopInterval, clearTimers])
  );

  // Immediate refresh when the subject changes (e.g. account switch).
  // Skips the very first run — mount is already covered by useFocusEffect,
  // so refreshing here too would double-fire on every screen entry.
  const lastKeyRef = useRef<AutoRefreshOptions["refreshKey"]>(refreshKey);
  useEffect(() => {
    if (!enabled) return;
    if (lastKeyRef.current === refreshKey) return;
    lastKeyRef.current = refreshKey;
    refreshWithCatchUp();
  }, [refreshKey, enabled, refreshWithCatchUp]);

  useEffect(() => clearTimers, [clearTimers]);

  return { refreshNow: runSafely, refreshWithCatchUp };
}
