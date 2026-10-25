'use client';

import React from 'react';
import { Recipe } from '../types';
import { useLang } from '../lib/i18n';
import { displayQuantity } from '../lib/quantity';
import { formatClock, stepIngredients, stepTimers } from '../lib/cooking';
import styles from './extras.module.css';

interface Props {
  /** The recipe as shown: translated and scaled to the chosen servings. */
  recipe: Recipe;
  onClose: () => void;
}

interface RunningTimer {
  id: number;
  label: string;
  step: number;
  endsAt: number;
  done: boolean;
}

/** Keeps the screen on while cooking, where the browser supports it. */
function useWakeLock() {
  React.useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const next = await nav.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        /* not allowed or not supported: the screen just dims as usual */
      }
    };
    void request();
    // The lock is dropped whenever the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/** A short beep that works without any sound file. */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach(at => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch { /* no audio */ }
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* no vibration */ }
}

export default function CookingMode({ recipe, onClose }: Props) {
  const { t, lang } = useLang();
  const steps = recipe.instructions || [];
  const [index, setIndex] = React.useState(0);
  const [showAll, setShowAll] = React.useState(false);
  const [timers, setTimers] = React.useState<RunningTimer[]>([]);
  const [now, setNow] = React.useState(() => Date.now());
  const nextId = React.useRef(1);
  const touchStart = React.useRef<number | null>(null);

  useWakeLock();

  const last = steps.length - 1;
  const go = React.useCallback((to: number) => setIndex(Math.max(0, Math.min(last, to))), [last]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, onClose]);

  // Tick while a timer runs; ring once when it reaches zero.
  React.useEffect(() => {
    if (!timers.some(tm => !tm.done)) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setTimers(prev => {
        let rang = false;
        const next = prev.map(tm => {
          if (!tm.done && tm.endsAt <= at) { rang = true; return { ...tm, done: true }; }
          return tm;
        });
        if (rang) beep();
        return rang ? next : prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, [timers]);

  // No scrolling the page behind the overlay.
  React.useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, []);

  const step = steps[index] || '';
  const used = stepIngredients(step, recipe.ingredients || []);
  const listed = showAll ? recipe.ingredients || [] : used;
  const found = stepTimers(step);

  const start = (label: string, seconds: number) => {
    setNow(Date.now());
    setTimers(prev => [...prev, { id: nextId.current++, label, step: index, endsAt: Date.now() + seconds * 1000, done: false }]);
  };
  const stop = (id: number) => setTimers(prev => prev.filter(tm => tm.id !== id));

  return (
    <div
      className={styles.cookOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t.cookingMode}
      onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStart.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current;
        touchStart.current = null;
        if (Math.abs(dx) > 60) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div className={styles.cookHeader}>
        <div className={styles.cookTitle}>{recipe.title}</div>
        <button type="button" className={styles.cookClose} onClick={onClose} aria-label={t.close}>×</button>
      </div>

      {timers.length > 0 && (
        <div className={styles.cookTimers} aria-live="polite">
          {timers.map(tm => (
            <button
              key={tm.id}
              type="button"
              className={`${styles.cookTimer} ${tm.done ? styles.cookTimerDone : ''}`}
              onClick={() => stop(tm.id)}
              title={t.stopTimer}
            >
              ⏱ {tm.done ? t.timerDone : formatClock((tm.endsAt - now) / 1000)}
              <span className={styles.cookTimerStep}>{t.stepShort(tm.step + 1)}</span> ×
            </button>
          ))}
        </div>
      )}

      <div className={styles.cookProgress}>
        {t.stepOf(index + 1, steps.length)}
        <div className={styles.cookBar}><div style={{ width: `${((index + 1) / Math.max(1, steps.length)) * 100}%` }} /></div>
      </div>

      <div className={styles.cookBody}>
        <p className={styles.cookStep}>{step}</p>

        {found.length > 0 && (
          <div className={styles.cookTimerButtons}>
            {found.map((ft, i) => (
              <button key={i} type="button" className={styles.cookStartTimer} onClick={() => start(ft.label, ft.seconds)}>
                ⏱ {t.startTimer(ft.label)}
              </button>
            ))}
          </div>
        )}

        {listed.length > 0 && (
          <ul className={styles.cookIngredients}>
            {listed.map((ing, i) => (
              <li key={i}><b>{displayQuantity(ing, lang)}</b> {ing.item}</li>
            ))}
          </ul>
        )}
        <button type="button" className={styles.linkButton} onClick={() => setShowAll(v => !v)}>
          {showAll ? t.ingredientsForStep : t.allIngredients}
        </button>
      </div>

      <div className={styles.cookNav}>
        <button type="button" className={styles.cookNavButton} onClick={() => go(index - 1)} disabled={index === 0}>
          ← {t.previous}
        </button>
        {index < last ? (
          <button type="button" className={`${styles.cookNavButton} ${styles.cookNavPrimary}`} onClick={() => go(index + 1)}>
            {t.next} →
          </button>
        ) : (
          <button type="button" className={`${styles.cookNavButton} ${styles.cookNavPrimary}`} onClick={onClose}>
            {t.doneCooking} ✓
          </button>
        )}
      </div>
    </div>
  );
}
