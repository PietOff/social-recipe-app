'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Wakes the backend as soon as the app opens.
 *
 * The backend runs on Render's free plan, which spins the service down after
 * 15 minutes without traffic and needs about a minute to start again. Instead
 * of making that minute start when the user presses "Get recipe", the app
 * pings the health endpoint on load and whenever the tab becomes visible
 * again. By the time a link has been copied and pasted the server is usually
 * up, and an extraction that starts earlier simply waits for the same ping.
 *
 * This only sends traffic while someone actually has the app open; it does not
 * keep the service awake in the background.
 */

export type BackendStatus = 'idle' | 'waking' | 'ready' | 'down';

export interface WarmupDeps {
  /** Resolves true when the backend answered with a 2xx. */
  ping: (timeoutMs: number) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  setTimer: (fn: () => void, ms: number) => () => void;
}

/** A successful ping this recent means the instance is still running (it sleeps after 15 min). */
export const FRESH_MS = 10 * 60 * 1000;
/** Show the "starting" state only if the first ping is slow, so a warm server never flashes it. */
export const WAKING_DELAY_MS = 1500;
/** Render's spin-up is about a minute; allow double before giving up. */
export const MAX_WAIT_MS = 120 * 1000;
const PING_TIMEOUT_MS = 30 * 1000;
const RETRY_DELAY_MS = 3000;

export function createWarmup(deps: WarmupDeps) {
  let status: BackendStatus = 'idle';
  let lastOk = 0;
  let inflight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: BackendStatus) => {
    if (next === status) return;
    status = next;
    listeners.forEach(l => l());
  };

  async function run(): Promise<boolean> {
    const deadline = deps.now() + MAX_WAIT_MS;
    const cancelWaking = deps.setTimer(() => set('waking'), WAKING_DELAY_MS);
    try {
      while (deps.now() < deadline) {
        const remaining = deadline - deps.now();
        let ok = false;
        try {
          ok = await deps.ping(Math.min(PING_TIMEOUT_MS, remaining));
        } catch {
          ok = false;
        }
        if (ok) {
          lastOk = deps.now();
          set('ready');
          return true;
        }
        // Proxies in front of a sleeping instance can fail fast (502/504);
        // keep knocking until it is up.
        if (deps.now() + RETRY_DELAY_MS >= deadline) break;
        await deps.sleep(RETRY_DELAY_MS);
      }
      set('down');
      return false;
    } finally {
      cancelWaking();
    }
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Resolves true once the backend responds. Concurrent callers share one wake-up. */
    wake(): Promise<boolean> {
      if (lastOk && deps.now() - lastOk < FRESH_MS) return Promise.resolve(true);
      if (!inflight) {
        inflight = run().finally(() => { inflight = null; });
      }
      return inflight;
    },
  };
}

const browserWarmup = createWarmup({
  async ping(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // `/api` is rewritten to the backend root, its health endpoint.
      const res = await fetch('/api', { cache: 'no-store', signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  },
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  setTimer(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
});

/** Wait for the backend to be up. Safe to call before every request. */
export const wakeBackend = () => browserWarmup.wake();

/** Starts the wake-up on mount and on returning to the tab; returns the current status. */
export function useBackendStatus(): BackendStatus {
  const status = useSyncExternalStore(
    browserWarmup.subscribe,
    browserWarmup.getStatus,
    () => 'idle' as BackendStatus,
  );

  useEffect(() => {
    void browserWarmup.wake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void browserWarmup.wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return status;
}
