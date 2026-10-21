import { describe, expect, it } from 'vitest';
import { ingredientQuantity, isPlatformUrl, isWebUrl, videoIdFromUrl } from '../recipes';

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
