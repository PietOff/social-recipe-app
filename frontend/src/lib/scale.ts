import { Ingredient, Recipe } from '../types';
import { Lang } from './i18n';

/**
 * Scaling recipes to a different number of servings.
 *
 * Amounts come from the extractor as free text - "400", "1/2", "1½", "0,5",
 * "2-3", "400g" - so every number inside the text is scaled on its own and the
 * rest of the text is left alone. "a pinch" or "naar smaak" pass through.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8,
};

// Order matters: a mixed number ("1 1/2") before a bare fraction before a
// plain number, so "1 1/2" is read as one value and not as 1 and 1/2.
const NUMBER = /(\d+)\s+(\d+)\/(\d+)|(\d+)?\s*([¼½¾⅓⅔⅛])|(\d+)\/(\d+)|(\d+(?:[.,]\d+)?)/g;

/** Nice fractions to prefer over decimals for small amounts ("1½", not "1,5"). */
const NICE_FRACTIONS: Array<[number, string]> = [
  [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'],
];

export function formatAmount(value: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  // Large amounts are grams or millilitres: nobody weighs 133 g, so round to 5.
  if (value >= 100) return String(Math.round(value / 5) * 5);
  if (value >= 10) return String(Math.round(value));

  const whole = Math.floor(value);
  const rest = value - whole;
  if (rest < 0.05) return String(whole);
  if (rest > 0.95) return String(whole + 1);
  for (const [fraction, glyph] of NICE_FRACTIONS) {
    if (Math.abs(rest - fraction) < 0.05) return whole ? `${whole}${glyph}` : glyph;
  }
  const rounded = String(Math.round(value * 10) / 10);
  return lang === 'nl' ? rounded.replace('.', ',') : rounded;
}

/** The amount text with every number in it multiplied by `factor`. */
export function scaleAmount(amount: string | undefined, factor: number, lang: Lang = 'en'): string {
  if (!amount) return '';
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return amount;
  return amount.replace(NUMBER, (match, mWhole, mNum, mDen, uWhole, uGlyph, fNum, fDen, plain) => {
    let value: number;
    if (mWhole !== undefined) value = Number(mWhole) + Number(mNum) / Number(mDen);
    else if (uGlyph !== undefined) value = (uWhole ? Number(uWhole) : 0) + UNICODE_FRACTIONS[uGlyph];
    else if (fNum !== undefined) value = Number(fNum) / Number(fDen);
    else value = Number(String(plain).replace(',', '.'));
    if (!Number.isFinite(value)) return match;
    // A leading space swallowed by the unicode branch ("1 ½") is put back.
    const lead = match.match(/^\s*/)?.[0] ?? '';
    return lead + formatAmount(value * factor, lang);
  });
}

/** The first whole number in a servings text: "4 people" -> 4, "2-3" -> 2. */
export function parseServings(servings?: string | null): number | null {
  const match = (servings || '').match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return n > 0 ? n : null;
}

export function scaleIngredients(ingredients: Ingredient[], factor: number, lang: Lang = 'en'): Ingredient[] {
  if (factor === 1) return ingredients;
  return ingredients.map(ing => ({ ...ing, amount: scaleAmount(ing.amount, factor, lang) }));
}

/** A copy of the recipe scaled by `factor`, servings text included. */
export function scaleRecipe(recipe: Recipe, factor: number, lang: Lang = 'en'): Recipe {
  if (factor === 1) return recipe;
  const base = parseServings(recipe.servings);
  return {
    ...recipe,
    ingredients: scaleIngredients(recipe.ingredients || [], factor, lang),
    servings: base && recipe.servings
      ? recipe.servings.replace(/\d+/, formatAmount(base * factor, lang))
      : recipe.servings,
  };
}
