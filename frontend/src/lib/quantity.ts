import { Ingredient } from '../types';
import { Lang } from './i18n';
import { formatAmount } from './scale';

/**
 * How an ingredient's amount and unit read on screen, in the reader's language.
 *
 * Recipes come from an AI and from many websites, so the same thing is
 * written many ways: "0.5 teaspoon", "1/2 tsp", "0,5 tl", "1 piece", "" for
 * salt. This only changes how they are shown; the stored recipe is untouched,
 * so scaling, editing and the shopping list keep working on the original text.
 */

/** Units that only say the item is counted; not shown ("1 egg", not "1 piece egg"). */
const COUNT_UNITS = new Set([
  'piece', 'pieces', 'pc', 'pcs', 'pc.', 'pcs.', 'item', 'items', 'unit', 'units', 'whole', 'x',
  'stuk', 'stuks', 'st', 'st.', 'stk', 'stk.',
]);

export function isCountUnit(unit: string | undefined | null): boolean {
  return COUNT_UNITS.has((unit || '').trim().toLowerCase());
}

type UnitNames = { en: [string, string]; nl: [string, string] };

/** Spellings of one unit -> its [singular, plural] name per language. */
const UNIT_TABLE: Array<[string[], UnitNames]> = [
  [['tablespoon', 'tablespoons', 'tbsp', 'tbsp.', 'tbs', 'tbs.', 'tbl', 'el', 'el.', 'eetlepel', 'eetlepels'],
    { en: ['tbsp', 'tbsp'], nl: ['el', 'el'] }],
  [['teaspoon', 'teaspoons', 'tsp', 'tsp.', 'tl', 'tl.', 'theelepel', 'theelepels'],
    { en: ['tsp', 'tsp'], nl: ['tl', 'tl'] }],
  [['clove', 'cloves', 'teentje', 'teentjes', 'teen', 'tenen'],
    { en: ['clove', 'cloves'], nl: ['teentje', 'teentjes'] }],
  [['pinch', 'pinches', 'snufje', 'snufjes', 'snuf'],
    { en: ['pinch', 'pinches'], nl: ['snufje', 'snufjes'] }],
  [['handful', 'handfuls', 'handje', 'handjes', 'handvol'],
    { en: ['handful', 'handfuls'], nl: ['handje', 'handjes'] }],
  [['slice', 'slices', 'plak', 'plakken', 'plakje', 'plakjes'],
    { en: ['slice', 'slices'], nl: ['plak', 'plakken'] }],
  [['can', 'cans', 'tin', 'tins', 'blik', 'blikken', 'blikje', 'blikjes'],
    { en: ['can', 'cans'], nl: ['blik', 'blikken'] }],
  [['bunch', 'bunches', 'bos', 'bosje', 'bosjes'],
    { en: ['bunch', 'bunches'], nl: ['bosje', 'bosjes'] }],
  [['sprig', 'sprigs', 'takje', 'takjes'],
    { en: ['sprig', 'sprigs'], nl: ['takje', 'takjes'] }],
  [['gram', 'grams', 'gr', 'gr.', 'g'], { en: ['g', 'g'], nl: ['g', 'g'] }],
  [['kilogram', 'kilograms', 'kilo', 'kilos', 'kg'], { en: ['kg', 'kg'], nl: ['kg', 'kg'] }],
  [['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'], { en: ['ml', 'ml'], nl: ['ml', 'ml'] }],
  [['liter', 'liters', 'litre', 'litres', 'l'], { en: ['l', 'l'], nl: ['l', 'l'] }],
];

const UNIT_LOOKUP = new Map<string, UnitNames>();
for (const [spellings, names] of UNIT_TABLE) for (const s of spellings) UNIT_LOOKUP.set(s, names);

/** Vague amounts, matched in either language and shown in the reader's. */
const VAGUE: Array<[RegExp, { en: string; nl: string }]> = [
  [/^(to taste|naar smaak|as needed|as required|naar behoefte|optional|optioneel)$/i,
    { en: 'to taste', nl: 'naar smaak' }],
  [/^(a pinch|pinch|een snufje|snufje|a little|een beetje|beetje)$/i,
    { en: 'a pinch', nl: 'een snufje' }],
  [/^(a dash|dash|a splash|splash|een scheutje|scheutje)$/i,
    { en: 'a dash', nl: 'een scheutje' }],
];

/** The single number an amount stands for, when it is just one number. */
function plainNumber(amount: string): number | null {
  const m = amount.trim().match(/^(\d+)(?:[.,](\d+))?$/);
  if (m) return Number(`${m[1]}.${m[2] ?? '0'}`);
  const frac = amount.trim().match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (frac && Number(frac[3])) return Number(frac[1] ?? 0) + Number(frac[2]) / Number(frac[3]);
  return null;
}

/** "0.5" -> "½", "1.5" -> "1½", "1/4" -> "¼", "0,33" -> "⅓"; larger amounts and ranges unchanged. */
export function prettyAmount(amount: string | undefined, lang: Lang): string {
  const text = (amount || '').trim();
  const value = plainNumber(text);
  if (value === null || value <= 0 || value >= 10) return text;
  // Whole numbers stay as written ("2" stays "2", "1.0" becomes "1").
  return formatAmount(value, lang);
}

/** The unit in the reader's language, singular or plural to match the amount. */
export function localUnit(unit: string | undefined, amount: string | undefined, lang: Lang): string {
  const raw = (unit || '').trim();
  if (!raw || isCountUnit(raw)) return '';
  const names = UNIT_LOOKUP.get(raw.toLowerCase());
  if (!names) return raw;
  const value = plainNumber(amount || '');
  const plural = value === null ? /[-–]|\d\s*\D+\s*\d/.test(amount || '') : value > 1;
  return names[lang][plural ? 1 : 0];
}

function vague(text: string, lang: Lang): string | null {
  for (const [pattern, words] of VAGUE) if (pattern.test(text.trim())) return words[lang];
  return null;
}

/**
 * The amount and unit as shown: "½ tl", "2 teentjes", "1", "naar smaak".
 * An ingredient with neither amount nor unit reads "naar smaak" / "to taste".
 */
export function displayQuantity(ing: Pick<Ingredient, 'amount' | 'unit'>, lang: Lang = 'en'): string {
  const rawAmount = (ing.amount || '').trim();
  const rawUnit = (ing.unit || '').trim();

  if (!rawAmount) {
    if (!rawUnit || isCountUnit(rawUnit)) return lang === 'nl' ? 'naar smaak' : 'to taste';
    return vague(rawUnit, lang) ?? localUnit(rawUnit, '1', lang);
  }
  const vagueAmount = vague(rawAmount, lang);
  if (vagueAmount) return vagueAmount;

  const amount = prettyAmount(rawAmount, lang);
  let unit = localUnit(rawUnit, rawAmount, lang);
  // "400g" already carries its unit.
  if (unit && amount.toLowerCase().endsWith(unit.toLowerCase())) unit = '';
  if (unit && rawUnit && amount.toLowerCase().endsWith(rawUnit.toLowerCase())) unit = '';
  return [amount, unit].filter(Boolean).join(' ');
}
