import { Nutrition, Recipe } from '../types';
import { apiPost } from './api';
import { nutritionBasis } from './nutrition';
import { recipeKey } from './recipes';

export const NUTRITION_BATCH = 8;

/** Estimates for up to NUTRITION_BATCH recipes, keyed by recipeKey. */
export async function fetchNutrition(recipes: Recipe[], signal?: AbortSignal): Promise<Map<string, Nutrition>> {
  const batch = recipes.slice(0, NUTRITION_BATCH);
  const response = await apiPost<{ results: Array<Omit<Nutrition, 'basis'> & { id: string }> }>(
    '/estimate-nutrition',
    {
      recipes: batch.map(r => ({
        id: recipeKey(r),
        title: r.title || '',
        servings: r.servings || null,
        ingredients: (r.ingredients || []).map(i => ({ item: i.item || '', amount: i.amount || '', unit: i.unit || '' })),
      })),
    },
    signal,
  );
  const byKey = new Map(batch.map(r => [recipeKey(r), r]));
  const out = new Map<string, Nutrition>();
  for (const res of response.results || []) {
    const r = byKey.get(res.id);
    if (!r) continue;
    out.set(res.id, {
      kcal: res.kcal, protein: res.protein, carbs: res.carbs, fat: res.fat,
      servings: res.servings ?? null,
      basis: nutritionBasis(r),
    });
  }
  return out;
}

