import { describe, expect, it } from 'vitest';
import { ingredientQuantity, isPlatformUrl, isWebUrl, videoIdFromUrl, withoutCountUnits } from '../recipes';

describe('ingredientQuantity', () => {
  it('does not repeat a unit the amount already has', () => {
    expect(ingredientQuantity({ amount: '400g', unit: 'g' })).toBe('400g');
    expect(ingredientQuantity({ amount: '400', unit: 'g' })).toBe('400 g');
  });

  it('drops units that only mean "counted"', () => {
    expect(ingredientQuantity({ amount: '1', unit: 'stuk' })).toBe('1');
    expect(ingredientQuantity({ amount: '2', unit: 'Pieces' })).toBe('2');
    expect(ingredientQuantity({ amount: '3', unit: 'stuks' })).toBe('3');
    expect(ingredientQuantity({ amount: '4', unit: 'teentjes' })).toBe('4 teentjes');
    expect(ingredientQuantity({ amount: '1', unit: 'el' })).toBe('1 el');
  });

  it('handles missing parts', () => {
    expect(ingredientQuantity({ amount: '2' })).toBe('2');
    expect(ingredientQuantity({ unit: 'snufje' })).toBe('snufje');
    expect(ingredientQuantity({})).toBe('');
  });
});

describe('recipe website links', () => {
  it('accepts any http(s) link and tells platforms apart', () => {
    expect(isWebUrl('https://www.leukerecepten.nl/recepten/stamppot/')).toBe(true);
    expect(isWebUrl('http://example.com/r')).toBe(true);
    expect(isWebUrl('ftp://example.com/r')).toBe(false);
    expect(isWebUrl('stamppot')).toBe(false);
    expect(isWebUrl('https://localhost/x')).toBe(false);
    expect(isPlatformUrl('https://vm.tiktok.com/abc')).toBe(true);
    expect(isPlatformUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isPlatformUrl('https://www.ah.nl/allerhande/recept/R-R1')).toBe(false);
  });

  it('never reads a video id out of a website path', () => {
    expect(videoIdFromUrl('https://www.example.nl/video/12345/pannenkoeken')).toBeNull();
    expect(videoIdFromUrl('https://www.example.nl/recept?v=abcdefghijk')).toBeNull();
    expect(videoIdFromUrl('https://www.tiktok.com/@chef/video/12345')).toBe('12345');
  });
});

describe('withoutCountUnits', () => {
  const base = {
    id: 'u_1', title: 'Ragu', description: '', instructions: ['Cook.'],
    ingredients: [
      { item: 'egg', amount: '1', unit: 'piece' },
      { item: 'flour', amount: '250', unit: 'g' },
    ],
  };

  it('removes count-only units and keeps the rest', () => {
    const out = withoutCountUnits(base)!;
    expect(out.ingredients.map(i => i.unit)).toEqual(['', 'g']);
    expect(out.id).toBe('u_1');
    expect(base.ingredients[0].unit).toBe('piece'); // original untouched
  });

  it('cleans cached translations too', () => {
    const out = withoutCountUnits({
      ...base,
      ingredients: [{ item: 'flour', amount: '250', unit: 'g' }],
      translations: { nl: { title: 'Ragu', description: '', instructions: ['Kook.'],
        ingredients: [{ item: 'ei', amount: '1', unit: 'stuk' }] } },
    })!;
    expect(out.translations!.nl!.ingredients[0].unit).toBe('');
  });

  it('returns null when there is nothing to clean', () => {
    expect(withoutCountUnits({ ...base, ingredients: [{ item: 'flour', amount: '250', unit: 'g' }] })).toBeNull();
  });
});
