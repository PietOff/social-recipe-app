import { Recipe } from '../types';
import { totalMinutes } from './labels';

export type SortOrder = 'newest' | 'oldest' | 'az' | 'za' | 'quickest';

export const SORT_ORDERS: SortOrder[] = ['newest', 'oldest', 'az', 'za', 'quickest'];

export function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === 'string' && (SORT_ORDERS as string[]).includes(value);
}

/**
 * Returns a sorted copy. Firestore hands recipes back in document-id order,
 * which is effectively random, so the cookbook needs an explicit order.
 *
 * Recipes without a `created_at` (saved before it was recorded) count as the
 * oldest. Recipes without a time sort last under "quickest". Ties keep the
 * incoming order, so the result is stable.
 */
export function sortRecipes(recipes: Recipe[], order: SortOrder, locale?: string): Recipe[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const indexed = recipes.map((recipe, index) => ({ recipe, index }));

  const compare = (a: Recipe, b: Recipe): number => {
    switch (order) {
      case 'newest':
        return (b.created_at ?? 0) - (a.created_at ?? 0);
      case 'oldest':
        return (a.created_at ?? 0) - (b.created_at ?? 0);
      case 'az':
        return collator.compare(a.title || '', b.title || '');
      case 'za':
        return collator.compare(b.title || '', a.title || '');
      case 'quickest': {
        const ta = totalMinutes(a);
        const tb = totalMinutes(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      }
    }
  };

  return indexed
    .sort((a, b) => compare(a.recipe, b.recipe) || a.index - b.index)
    .map(entry => entry.recipe);
}
