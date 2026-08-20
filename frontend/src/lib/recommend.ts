import { Recipe } from '../types';
import { apiPost } from './api';
import { recipeKey } from './recipes';

/** Tap-able starting points. Free text is combined with whatever is selected. */
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

/** The backend refuses more than this, so a large cookbook is pre-filtered. */
const MAX_CANDIDATES = 300;

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
    .slice(0, 10);
}

/** Everything about a recipe that could plausibly match a mood, lowercased. */
function searchableText(recipe: Recipe): string {
  return [
    recipe.title,
    recipe.description,
    ...(recipe.tags || []),
    recipe.category || '',
    ...ingredientNames(recipe),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Cheap keyword overlap, used only to choose WHICH recipes the model gets to
 * see when the cookbook is bigger than one prompt. The model still does the
 * actual choosing.
 */
function relevanceScore(recipe: Recipe, terms: string[]): number {
  if (terms.length === 0) return 0;
  const text = searchableText(recipe);
  return terms.reduce((score, term) => (text.includes(term) ? score + 1 : score), 0);
}

export function prefilter(recipes: Recipe[], wanted: string): Recipe[] {
  if (recipes.length <= MAX_CANDIDATES) return recipes;

  const terms = wanted
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);

  // Stable: score descending, original order preserved within a score.
  return recipes
    .map((recipe, index) => ({ recipe, index, score: relevanceScore(recipe, terms) }))
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
): Promise<SuggestionSet> {
  const usable = recipes.filter(r => recipeKey(r));
  const wanted = [moods.join(', '), mood].filter(Boolean).join(' ');
  const candidates = prefilter(usable, wanted);

  const byKey = new Map(candidates.map(r => [recipeKey(r), r]));

  const response = await apiPost<{ intro?: string; picks?: Pick[] }>(
    '/recommend',
    {
      mood,
      moods,
      limit,
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
    considered: candidates.length,
    total: usable.length,
  };
}
