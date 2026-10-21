import { describe, expect, it } from 'vitest';
import { createWarmup, FRESH_MS, MAX_WAIT_MS, WAKING_DELAY_MS, WarmupDeps } from '../warmup';

/** Deterministic clock: sleeps and pings advance time instead of waiting. */
function fakeDeps(pingResults: Array<{ ok: boolean; takesMs: number }>) {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const fire = () => timers.filter(x => x.live && x.at <= t).forEach(x => { x.live = false; x.fn(); });
  const advance = (ms: number) => { t += ms; fire(); };
  let calls = 0;
  const deps: WarmupDeps = {
    now: () => t,
    async ping() {
      const r = pingResults[Math.min(calls, pingResults.length - 1)];
      calls++;
      advance(r.takesMs);
      return r.ok;
    },
    async sleep(ms) { advance(ms); },
    setTimer(fn, ms) {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
  };
  return { deps, advance, pingCount: () => calls };
}

describe('backend warm-up', () => {
  it('goes straight to ready for a warm server without showing "waking"', async () => {
    const { deps } = fakeDeps([{ ok: true, takesMs: 200 }]);
    const w = createWarmup(deps);
    const seen: string[] = [];
    w.subscribe(() => seen.push(w.getStatus()));
    expect(await w.wake()).toBe(true);
    expect(seen).toEqual(['ready']);
  });

  it('shows "waking" during a slow cold start, then ready', async () => {
    const { deps } = fakeDeps([
      { ok: false, takesMs: 10_000 }, // proxy gives up while the instance boots
      { ok: true, takesMs: 45_000 },
    ]);
    const w = createWarmup(deps);
    const seen: string[] = [];
    w.subscribe(() => seen.push(w.getStatus()));
    expect(await w.wake()).toBe(true);
    expect(seen).toEqual(['waking', 'ready']);
    expect(WAKING_DELAY_MS).toBeLessThan(10_000);
  });

  it('shares one wake-up between concurrent callers', async () => {
    const { deps, pingCount } = fakeDeps([{ ok: true, takesMs: 100 }]);
    const w = createWarmup(deps);
    const [a, b] = await Promise.all([w.wake(), w.wake()]);
    expect(a && b).toBe(true);
    expect(pingCount()).toBe(1);
  });

  it('skips the ping while a recent success is fresh, and pings again after', async () => {
    const { deps, advance, pingCount } = fakeDeps([{ ok: true, takesMs: 100 }]);
    const w = createWarmup(deps);
    await w.wake();
    advance(FRESH_MS - 1000);
    await w.wake();
    expect(pingCount()).toBe(1);
    advance(2000);
    await w.wake();
    expect(pingCount()).toBe(2);
  });

  it('gives up as "down" after the maximum wait', async () => {
    const { deps } = fakeDeps([{ ok: false, takesMs: 30_000 }]);
    const w = createWarmup(deps);
    const start = deps.now();
    expect(await w.wake()).toBe(false);
    expect(w.getStatus()).toBe('down');
    expect(deps.now() - start).toBeLessThanOrEqual(MAX_WAIT_MS + 30_000);
  });

  it('treats a throwing ping (network error) as not ready yet', async () => {
    const { deps } = fakeDeps([{ ok: true, takesMs: 100 }]);
    let first = true;
    const ping = deps.ping;
    deps.ping = async (ms) => {
      if (first) { first = false; throw new TypeError('Failed to fetch'); }
      return ping(ms);
    };
    const w = createWarmup(deps);
    expect(await w.wake()).toBe(true);
  });
});
