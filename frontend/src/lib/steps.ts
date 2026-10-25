import { Ingredient } from '../types';
import { Lang } from './i18n';
import { localUnit, prettyAmount } from './quantity';
import { scaleAmount } from './scale';
import { normalize } from './text';

/**
 * Amounts written inside the cooking steps, scaled with the servings.
 *
 * Steps are free text full of numbers that must NOT scale: oven temperatures,
 * minutes, "divide into 15 balls of 30 g". So a number is only scaled when it
 * is clearly one of the recipe's ingredients: the same amount (and the same
 * unit, in either language) as an ingredient, followed within a few words by
 * that ingredient's name. "Doe 250 g bloem" scales; "200 °C" and "balletjes
 * van 30 g" are left alone.
 */

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[¼½¾⅓⅔⅛]|\d+\s*[¼½¾⅓⅔⅛]`;

/** A single number from an amount text: "250", "0,5", "1/2", "1½". */
function value(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const glyphs: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  const mixed = t.match(/^(\d+)?\s*([¼½¾⅓⅔⅛])$/);
  if (mixed) return Number(mixed[1] ?? 0) + glyphs[mixed[2]];
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

/** The unit's canonical key, so "theelepel", "tsp" and "tl" are the same unit. */
function unitKey(unit: string): string {
  return localUnit(unit, '1', 'en').toLowerCase();
}

/** First meaningful word of an ingredient name: "Halfvolle melk" -> "halfvolle". */
function nameWords(item: string): string[] {
  return normalize(item)
    .replace(/\(.*?\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3)
    .slice(0, 3);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The steps with ingredient amounts multiplied by `factor`. */
export function scaleSteps(steps: string[], ingredients: Ingredient[], factor: number, lang: Lang = 'en'): string[] {
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return steps;

  const known = ingredients
    .map(ing => ({
      amount: value(ing.amount || ''),
      unit: unitKey(ing.unit || ''),
      words: nameWords(ing.item || ''),
    }))
    .filter(k => k.amount !== null && k.words.length > 0);
  if (known.length === 0) return steps;

  // "<number> [unit] <up to three words> <ingredient word>"
  const pattern = new RegExp(
    // The words after the unit are only looked at, not consumed, so the next
    // amount in the same sentence ("250 g bloem, 2 tl zout") is still found.
    String.raw`(^|[^\p{L}\p{N},.\/])(${NUM})(\s*)([\p{L}.]+)?(?=((?:[\s,]+[\p{L}\p{N}'’-]+){0,4}))`,
    'gu',
  );

  return steps.map(step => step.replace(pattern, (whole, lead: string, num: string, gap: string, unitWord: string | undefined, rest: string) => {
    const amount = value(num);
    if (amount === null) return whole;
    const written = normalize(`${unitWord ?? ''}${rest}`);
    const unit = unitWord ? unitKey(unitWord.replace(/\.$/, '')) : '';

    const match = known.find(k => {
      if (Math.abs((k.amount as number) - amount) > 1e-6) return false;
      // With a unit, the unit must agree; without one, the word after the
      // number is the ingredient itself ("2 eieren").
      const sameUnit = k.unit ? k.unit === unit : true;
      if (!sameUnit) return false;
      return k.words.some(w => new RegExp(`(^|[^\\p{L}])${escape(w)}`, 'u').test(written));
    });
    if (!match) return whole;

    const scaled = prettyAmount(scaleAmount(num.replace(/\s+/g, ''), factor, lang), lang);
    let unitOut = unitWord ?? '';
    if (unitWord && match.unit) {
      const local = localUnit(unitWord.replace(/\.$/, ''), scaled, lang);
      // Keep the writer's own word ("theelepel") unless it is a short unit we
      // know the plural of; then follow the new amount ("1 teentje" -> "2 teentjes").
      if (local && normalize(local) !== normalize(unitWord)) {
        const singularBefore = localUnit(unitWord.replace(/\.$/, ''), '1', lang);
        if (normalize(singularBefore) === normalize(unitWord) || normalize(localUnit(unitWord.replace(/\.$/, ''), '2', lang)) === normalize(unitWord)) {
          unitOut = local;
        }
      }
    }
    return `${lead}${scaled}${gap}${unitOut}`;
  }));
}
