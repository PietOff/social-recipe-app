import { Ingredient } from '../types';
import { normalize } from './text';

/**
 * Helpers for cooking mode: timers found in a step, and the ingredients a
 * step uses.
 */

export interface StepTimer {
  /** The text it came from, e.g. "10-12 minuten". */
  label: string;
  seconds: number;
}

const UNIT_SECONDS: Array<[RegExp, number]> = [
  [/^(?:h|hr|hrs|hour|hours|uur|uren|u)$/, 3600],
  [/^(?:m|min|mins|minute|minutes|minuut|minuten|minuutjes)$/, 60],
  [/^(?:s|sec|secs|second|seconds|seconde|seconden)$/, 1],
];

function unitSeconds(unit: string): number | null {
  const u = normalize(unit).replace(/\.$/, '');
  for (const [re, s] of UNIT_SECONDS) if (re.test(u)) return s;
  return null;
}

/**
 * Durations in a step: "10 minuten", "25 mins", "1 uur", "1,5 hour",
 * "10-12 minutes" (the longer end, so nothing comes out underdone),
 * "1 uur en 15 minuten" (added up). Temperatures and plain numbers are ignored.
 */
export function stepTimers(step: string): StepTimer[] {
  const out: StepTimer[] = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|tot|to|à|a)\s*(\d+(?:[.,]\d+)?))?\s*(uur|uren|hours?|hrs?|h|minuten|minuutjes|minuut|minutes?|mins?|min|m|seconden|seconde|seconds?|secs?|sec|s)\.?(?![\p{L}])/giu;
  let m: RegExpExecArray | null;
  let last: { end: number; timer: StepTimer } | null = null;
  while ((m = re.exec(step))) {
    const per = unitSeconds(m[3]);
    if (!per) continue;
    const high = Number((m[2] ?? m[1]).replace(',', '.'));
    const seconds = Math.round(high * per);
    if (!seconds) continue;
    // "1 uur en 15 minuten" / "1 hour 15 minutes": one timer, added up.
    if (last && /^\s*(?:en|and|,)?\s*$/i.test(step.slice(last.end, m.index)) && per < last.timer.seconds) {
      last.timer.seconds += seconds;
      last.timer.label = step.slice(step.indexOf(last.timer.label), m.index + m[0].length).trim().replace(/\.$/, '');
      last.end = m.index + m[0].length;
      continue;
    }
    const timer = { label: m[0].trim().replace(/\.$/, ''), seconds };
    out.push(timer);
    last = { end: m.index + m[0].length, timer };
  }
  return out;
}

/** "12:30" or "1:05:00". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function nameWords(item: string): string[] {
  return normalize(item)
    .replace(/\(.*?\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3);
}

/** The ingredients named in a step, in recipe order. */
export function stepIngredients(step: string, ingredients: Ingredient[]): Ingredient[] {
  const text = normalize(step);
  return ingredients.filter(ing => {
    const words = nameWords(ing.item || '');
    if (words.length === 0) return false;
    // The ingredient's main word (usually the noun, last for English
    // "minced beef", first for Dutch "bloem, gezeefd") must appear.
    return words.slice(0, 3).some(w => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text));
  });
}
