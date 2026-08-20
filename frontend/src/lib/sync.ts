import { Recipe } from '../types';
import { saveRecipeToCloud, recipeKey, isSameRecipe } from './recipes';

/**
 * Recipes that were saved while signed in but never reached Firestore.
 *
 * Cloud writes used to fail silently: the catch logged to the console, wrote the
 * recipe to the local cache and let the UI say "Saved to Cookbook!". A cookbook
 * that looked full could be entirely local, so a second device showed nothing.
 * Anything that fails now lands in this queue, is visible in the UI, and is
 * retried on the next successful cookbook load.
 */
const PENDING_KEY = 'chefSocial_pending_sync';

export function loadPendingSync(): Recipe[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(recipes: Recipe[]): void {
  try {
    if (recipes.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(recipes));
  } catch {
    /* quota - the recipe is still in the cached cookbook */
  }
}

export function addPendingSync(recipe: Recipe): Recipe[] {
  const next = [...loadPendingSync().filter(r => !isSameRecipe(r, recipe)), recipe];
  writePending(next);
  return next;
}

export function removePendingSync(recipe: Recipe): Recipe[] {
  const next = loadPendingSync().filter(r => !isSameRecipe(r, recipe));
  writePending(next);
  return next;
}

export function clearPendingSync(): void {
  writePending([]);
}

export interface FlushResult {
  synced: Recipe[];
  remaining: Recipe[];
  lastError: string | null;
}

/**
 * Re-pushes everything in the queue. Saves are idempotent (deterministic doc
 * ids), so retrying a recipe that did land is harmless.
 */
export async function flushPendingSync(uid: string): Promise<FlushResult> {
  const pending = loadPendingSync();
  if (pending.length === 0) return { synced: [], remaining: [], lastError: null };

  const synced: Recipe[] = [];
  const remaining: Recipe[] = [];
  let lastError: string | null = null;

  for (const recipe of pending) {
    try {
      synced.push(await saveRecipeToCloud(uid, recipe));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      remaining.push(recipe);
    }
  }

  writePending(remaining);
  return { synced, remaining, lastError };
}

/** Merges freshly synced recipes into a list, replacing the local-only copies. */
export function mergeSynced(existing: Recipe[], synced: Recipe[]): Recipe[] {
  if (synced.length === 0) return existing;
  const bySyncedKey = new Map(synced.map(r => [recipeKey(r), r]));
  const untouched = existing.filter(r => !synced.some(s => isSameRecipe(s, r)));
  return [...bySyncedKey.values(), ...untouched];
}
