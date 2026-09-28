import { describe, expect, it } from 'vitest';
import { formatAmount, parseServings, scaleAmount, scaleRecipe } from '../scale';
import { recipe } from './helpers';

describe('scaleAmount', () => {
  it('scales plain numbers, keeping the rest of the text', () => {
    expect(scaleAmount('400', 1.5)).toBe('600');
    expect(scaleAmount('400g', 2)).toBe('800g');
    expect(scaleAmount('2 cloves', 2)).toBe('4 cloves');
  });

  it('scales fractions, mixed numbers and decimals', () => {
    expect(scaleAmount('1/2', 2)).toBe('1');
    expect(scaleAmount('1 1/2', 2)).toBe('3');
    expect(scaleAmount('1½', 2)).toBe('3');
    expect(scaleAmount('½', 3)).toBe('1½');
    expect(scaleAmount('0,5', 3, 'nl')).toBe('1½');
    expect(scaleAmount('1.2', 2, 'nl')).toBe('2,4');
  });

  it('scales both ends of a range', () => {
    expect(scaleAmount('2-3', 2)).toBe('4-6');
  });

  it('leaves text without numbers alone', () => {
    expect(scaleAmount('naar smaak', 2)).toBe('naar smaak');
    expect(scaleAmount('', 2)).toBe('');
  });

  it('does nothing at factor 1', () => {
    expect(scaleAmount('1/3', 1)).toBe('1/3');
  });
});

describe('formatAmount', () => {
  it('rounds grams to 5 and prefers nice fractions for small amounts', () => {
    expect(formatAmount(133.3)).toBe('135');
    expect(formatAmount(12.4)).toBe('12');
    expect(formatAmount(0.33)).toBe('⅓');
    expect(formatAmount(2.75)).toBe('2¾');
    expect(formatAmount(1.4, 'nl')).toBe('1,4');
    expect(formatAmount(2.02)).toBe('2');
  });
});

describe('parseServings', () => {
  it('reads the first number', () => {
    expect(parseServings('4 people')).toBe(4);
    expect(parseServings('2-3 personen')).toBe(2);
    expect(parseServings('serves a crowd')).toBeNull();
    expect(parseServings(undefined)).toBeNull();
  });
});

describe('scaleRecipe', () => {
  it('scales ingredients and the servings text', () => {
    const scaled = scaleRecipe(
      { ...recipe('Curry', []), ingredients: [{ item: 'rice', amount: '200', unit: 'g' }], servings: '2 personen' },
      2,
    );
    expect(scaled.ingredients[0].amount).toBe('400');
    expect(scaled.servings).toBe('4 personen');
  });
});
