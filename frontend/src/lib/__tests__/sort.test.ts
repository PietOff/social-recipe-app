import { describe, expect, it } from 'vitest';
import { isSortOrder, sortRecipes } from '../sort';
import { recipe } from './helpers';

const a = recipe('Appeltaart', [], { created_at: 100, prep_time: '30 min', cook_time: '45 min' });
const b = recipe('banana bread', [], { created_at: 300, prep_time: '10 min' });
const c = recipe('Curry 10', [], { created_at: 200 });
const d = recipe('Curry 9');
const titles = (list: typeof a[]) => list.map(r => r.title);

describe('sortRecipes', () => {
  it('sorts newest first, undated last', () => {
    expect(titles(sortRecipes([a, b, c, d], 'newest'))).toEqual(['banana bread', 'Curry 10', 'Appeltaart', 'Curry 9']);
  });

  it('sorts oldest first, undated first', () => {
    expect(titles(sortRecipes([a, b, c, d], 'oldest'))).toEqual(['Curry 9', 'Appeltaart', 'Curry 10', 'banana bread']);
  });

  it('sorts titles case-insensitively and numbers naturally', () => {
    expect(titles(sortRecipes([c, d, b, a], 'az', 'nl'))).toEqual(['Appeltaart', 'banana bread', 'Curry 9', 'Curry 10']);
    expect(titles(sortRecipes([c, d, b, a], 'za', 'nl'))).toEqual(['Curry 10', 'Curry 9', 'banana bread', 'Appeltaart']);
  });

  it('sorts quickest first, recipes without a time last', () => {
    expect(titles(sortRecipes([d, a, c, b], 'quickest'))).toEqual(['banana bread', 'Appeltaart', 'Curry 9', 'Curry 10']);
  });

  it('keeps the original order for ties and does not mutate the input', () => {
    const input = [d, c];
    const sorted = sortRecipes(input, 'quickest');
    expect(titles(sorted)).toEqual(['Curry 9', 'Curry 10']);
    expect(input).toEqual([d, c]);
  });
});

describe('isSortOrder', () => {
  it('accepts only known orders', () => {
    expect(isSortOrder('az')).toBe(true);
    expect(isSortOrder('random')).toBe(false);
    expect(isSortOrder(null)).toBe(false);
  });
});
