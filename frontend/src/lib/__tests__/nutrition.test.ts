import { describe, expect, it } from 'vitest';
import { hasCurrentNutrition, needsNutrition, nutritionBasis, nutritionLabels } from '../nutrition';
import { labelValues } from '../labels';
import { recipe } from './helpers';

const base = recipe('Ragu', ['sausage', 'pasta'], { servings: '4 people' });
const withN = (r = base, n = { kcal: 480, protein: 34, carbs: 50, fat: 15 }) => ({ ...r, nutrition: { ...n, basis: nutritionBasis(r) } });

describe('nutrition', () => {
  it('needs an estimate until one matches the ingredients', () => {
    expect(needsNutrition(base)).toBe(true);
    expect(needsNutrition(withN())).toBe(false);
    expect(hasCurrentNutrition(withN())).toBe(true);
  });

  it('goes stale when ingredients or servings change, not when the title does', () => {
    const r = withN();
    expect(hasCurrentNutrition({ ...r, servings: '2 people' })).toBe(false);
    expect(hasCurrentNutrition({ ...r, ingredients: [...r.ingredients, { item: 'cream', amount: '200', unit: 'ml' }] })).toBe(false);
    expect(hasCurrentNutrition({ ...r, title: 'Worst ragu' })).toBe(true);
  });

  it('skips recipes without ingredients', () => {
    expect(needsNutrition(recipe('Empty'))).toBe(false);
  });

  it('labels high-protein and light recipes from the numbers', () => {
    expect(nutritionLabels(withN())).toEqual(['High protein', 'Under 500 kcal']);
    expect(nutritionLabels(withN(base, { kcal: 820, protein: 22, carbs: 90, fat: 35 }))).toEqual([]);
    expect(nutritionLabels(base)).toEqual([]);
    expect(labelValues(withN())).toContain('Under 500 kcal');
  });

  it('does not double a "High-Protein" tag', () => {
    const tagged = withN({ ...base, tags: ['High-Protein'] });
    expect(labelValues(tagged).filter(l => l.toLowerCase().replace('-', ' ') === 'high protein')).toHaveLength(1);
  });
});
