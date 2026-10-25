import { Nutrition, Recipe } from '../types';

/**
 * Estimated nutrition per serving.
 *
 * The backend asks the recipe AI for kcal and macros per serving, checks the
 * numbers add up, and the app keeps the result on the recipe (and in
 * Firestore), so each recipe is estimated once. The estimate is tied to a
 * fingerprint of the ingredients and servings: editing the recipe makes it
 * stale and it is estimated again. Translations do not change the
 * fingerprint, since the original ingredients are used.
 */

/** Short, stable fingerprint of what the estimate depends on. */
export function nutritionBasis(r: Recipe): string {
  const text = [
    r.servings || '',
    ...(r.ingredients || []).map(i => `${i.amount || ''}|${i.unit || ''}|${i.item || ''}`.toLowerCase().trim()),
  ].join('\n');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function hasCurrentNutrition(r: Recipe): boolean {
  return !!r.nutrition && r.nutrition.basis === nutritionBasis(r);
}

/** Recipes worth estimating: some ingredients, and no current estimate. */
export function needsNutrition(r: Recipe): boolean {
  return (r.ingredients || []).some(i => (i.item || '').trim()) && !hasCurrentNutrition(r);
}

/** Derived labels from a current estimate, for filtering. */
export function nutritionLabels(r: Recipe): string[] {
  if (!hasCurrentNutrition(r)) return [];
  const n = r.nutrition as Nutrition;
  const out: string[] = [];
  if (n.protein >= 30) out.push('High protein');
  if (n.kcal <= 500) out.push('Under 500 kcal');
  return out;
}
