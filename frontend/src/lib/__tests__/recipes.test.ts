import { describe, expect, it } from 'vitest';
import { ingredientQuantity } from '../recipes';

describe('ingredientQuantity', () => {
  it('does not repeat a unit the amount already has', () => {
    expect(ingredientQuantity({ amount: '400g', unit: 'g' })).toBe('400g');
    expect(ingredientQuantity({ amount: '400', unit: 'g' })).toBe('400 g');
  });

  it('handles missing parts', () => {
    expect(ingredientQuantity({ amount: '2' })).toBe('2');
    expect(ingredientQuantity({ unit: 'snufje' })).toBe('snufje');
    expect(ingredientQuantity({})).toBe('');
  });
});
