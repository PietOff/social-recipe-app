import { Recipe } from '../types';
import { apiPost } from './api';
import { recipeKey } from './recipes';
import { containsTerm } from './text';
import { expandTerm, queryWords, searchableText } from './search';
import { Lang } from './i18n';

/** Tap-able starting points. Free text is combined with whatever is selected.
 *  Sent to the backend in English whatever the UI language; the Dutch names
 *  are display-only (see LABELS_NL in lib/i18n.tsx). */
export const MOOD_CHIPS = [
  'Quick (under 20 min)',
  'Comfort food',
  'Healthy & light',
  'Spicy',
  'Vegetarian',
  'High protein',
  'One pan / minimal washing up',
  'Cooking to impress',
] as const;

/** The backend refuses more than this, so a large cookbook is pre-filtered.
 *  Kept well below the old 300: at 300 recipes with ingredients the prompt ran
 *  past Groq's request limit, so a Gemini blip took the whole feature down with
 *  a 413 instead of falling back. The backend trims further if it still has to. */
const MAX_CANDIDATES = 150;

export interface Pick {
  id: string;
  reason: string;
}

export interface Suggestion {
  recipe: Recipe;
  reason: string;
}

export interface SuggestionSet {
  intro: string;
  results: Suggestion[];
  /** How many recipes were considered, vs how many exist. Surfaced in the UI so
   *  a pre-filtered run never silently pretends it read the whole cookbook. */
  considered: number;
  total: number;
}

function ingredientNames(recipe: Recipe): string[] {
  return (recipe.ingredients || [])
    .map(i => (i?.item || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Cheap keyword overlap, used only to choose WHICH recipes the model gets to
 * see when the cookbook is bigger than one prompt. The model still does the
 * actual choosing. Each term is a synonym group, so a Dutch mood ("iets met
 * kip") still finds the English recipes.
 */
function relevanceScore(text: string, terms: string[][]): number {
  return terms.reduce((score, group) => (group.some(t => containsTerm(text, t)) ? score + 1 : score), 0);
}

/** Fisher-Yates on a copy. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function prefilter(recipes: Recipe[], wanted: string): Recipe[] {
  // Letters outside a-z count as word characters: the old /[^a-z0-9]+/ split
  // cut "crème" and "één" in half.
  const terms = queryWords(wanted)
    .filter(t => t.length > 2)
    .map(expandTerm);

  // "Surprise me" has nothing to rank by, so every recipe scores zero and the
  // order stays as saved - meaning the same handful off the top of the cookbook
  // every single time, and never the other 250. Shuffle instead. The backend
  // trims from the head to fit the prompt, so the head is what must vary.
  if (terms.length === 0) {
    return shuffled(recipes).slice(0, MAX_CANDIDATES);
  }

  if (recipes.length <= MAX_CANDIDATES) return recipes;

  // Stable: score descending, original order preserved within a score.
  return recipes
    .map((recipe, index) => ({ recipe, index, score: relevanceScore(searchableText(recipe), terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_CANDIDATES)
    .map(entry => entry.recipe);
}

export async function recommendFromCookbook(
  recipes: Recipe[],
  moods: string[],
  mood: string,
  limit = 5,
  signal?: AbortSignal,
  language: Lang = 'en',
): Promise<SuggestionSet> {
  const usable = recipes.filter(r => recipeKey(r));
  const wanted = [moods.join(', '), mood].filter(Boolean).join(' ');
  const candidates = prefilter(usable, wanted);

  const byKey = new Map(candidates.map(r => [recipeKey(r), r]));

  const response = await apiPost<{ intro?: string; picks?: Pick[]; considered?: number }>(
    '/recommend',
    {
      mood,
      moods,
      limit,
      // The language the intro and reasons are written in.
      language,
      recipes: candidates.map(r => ({
        id: recipeKey(r),
        title: r.title || '',
        description: r.description || '',
        tags: r.tags || (r.category ? [r.category] : []),
        prep_time: r.prep_time || null,
        cook_time: r.cook_time || null,
        servings: r.servings || null,
        ingredients: ingredientNames(r),
      })),
    },
    signal,
  );

  const results: Suggestion[] = [];
  for (const pick of response.picks || []) {
    const recipe = byKey.get(pick?.id);
    if (recipe) results.push({ recipe, reason: pick.reason || '' });
  }

  return {
    intro: response.intro || '',
    results,
    // The backend trims the listing further if the prompt would not fit, so
    // trust its count over how many we sent - otherwise the UI overstates how
    // much of the cookbook was actually read.
    considered: Math.min(response.considered ?? candidates.length, candidates.length),
    total: usable.length,
  };
}
