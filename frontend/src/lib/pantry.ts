import { Ingredient, Recipe } from '../types';
import { expandTerm, queryWords } from './search';
import { containsTerm, normalize } from './text';

/**
 * "What can I make with...": recipes ranked by how much of them you can make
 * with what you have.
 *
 * Each thing you have is expanded to its synonyms in both languages ("kip"
 * also finds "chicken thighs"), so a Dutch fridge finds English recipes.
 * Kitchen staples that are nearly always in the house (salt, pepper, oil,
 * water, sugar) are assumed and never listed as missing.
 */

/** Always in the house: never asked for, never listed as missing. Matched on
 *  the last word of the name, so "extra-virgin olive oil" and "brown sugar"
 *  count, but "bell pepper" and "chilli pepper" do not. */
const STAPLE_NOUNS = ['salt', 'zout', 'pepper', 'peper', 'oil', 'olie', 'olijfolie', 'zonnebloemolie',
  'water', 'sugar', 'suiker', 'spray', 'bakspray', 'ice', 'ijs', 'cubes', 'ijsblokjes'];
const NOT_STAPLE = /bell|paprika|chill?i|jalape|sesame|sesam|truffle|truffel|cayenne|szechuan|sichuan/;

/** Herbs, spices and garnish: nice to have, but they don't decide whether you
 *  can make a dish, so they are not counted as missing either. */
const OPTIONAL = /powder|poeder|seasoning|kruiden|kruidenmix|dried|gedroogd|flakes|vlokken|spice|specerij|garnish|garnering|for serving|om te serveren|optional|optioneel|to taste|naar smaak|parsley|peterselie|coriander|koriander|cilantro|basil|basilicum|\bmint|\bmunt\b|dill|dille|chives|bieslook|thyme|tijm|rosemary|rozemarijn|oregano|cumin|komijn|cinnamon|kaneel|nutmeg|nootmuskaat|bay lea|laurier|sesame seeds|sesamzaad|parchment|bakpapier|skewers|spiesjes/;

/** The ingredient's own name, without "(e.g. ...)" or ", finely chopped". */
export function coreName(item: string): string {
  return normalize(item).replace(/\(.*?\)/g, ' ').split(/[,;]/)[0].replace(/\s+/g, ' ').trim();
}

function isStaple(item: string): boolean {
  const name = coreName(item);
  const last = name.split(' ').pop() || '';
  return STAPLE_NOUNS.includes(last) && !NOT_STAPLE.test(name);
}

function isOptional(item: string): boolean {
  return OPTIONAL.test(normalize(item));
}

/** Fewer than this many real ingredients is a side or a component, not a dish. */
const MIN_INGREDIENTS = 3;

/** The things typed, split on commas, "and"/"en" and new lines. */
export function parseHave(text: string): string[] {
  return text
    .split(/[,;\n]+|\s+(?:and|en|&)\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
}

export interface PantryMatch {
  recipe: Recipe;
  have: Ingredient[];
  missing: Ingredient[];
}

/**
 * Which of the things you have is this ingredient (its index), or -1. A
 * multi-word entry matches when all its words do ("chicken thighs"), or else
 * on its last word, the noun in both languages ("rode ui" is an onion), since
 * adjectives rarely have a translation of their own. Only the ingredient's
 * own name is looked at, not "(e.g. ...)" or preparation notes.
 */
function coveringEntry(item: string, have: string[]): number {
  const text = coreName(item);
  const hit = (w: string) => expandTerm(w).some(term => containsTerm(text, term));
  return have.findIndex(entry => {
    const words = queryWords(entry).filter(w => w.length > 1);
    if (words.length === 0) return false;
    return words.every(hit) || hit(words[words.length - 1]);
  });
}

/**
 * Recipes that use at least one thing you have, best first: the ones that use
 * most of what you named, then the fewest missing, then the largest share
 * covered. Tiny recipes ("steamed rice") are left out.
 */
export function pantryMatches(recipes: Recipe[], haveText: string, limit = 30): PantryMatch[] {
  const have = parseHave(haveText);
  if (have.length === 0) return [];
  const scored: Array<PantryMatch & { used: number }> = [];
  for (const recipe of recipes) {
    const needed = (recipe.ingredients || []).filter(i => (i.item || '').trim() && !isStaple(i.item) && !isOptional(i.item));
    if (needed.length < MIN_INGREDIENTS) continue;
    const got: Ingredient[] = [];
    const missing: Ingredient[] = [];
    const usedEntries = new Set<number>();
    for (const ing of needed) {
      const entry = coveringEntry(ing.item, have);
      if (entry >= 0) { got.push(ing); usedEntries.add(entry); } else missing.push(ing);
    }
    if (got.length > 0) scored.push({ recipe, have: got, missing, used: usedEntries.size });
  }
  const share = (m: PantryMatch) => m.have.length / (m.have.length + m.missing.length);
  return scored
    .sort((a, b) => b.used - a.used || a.missing.length - b.missing.length || share(b) - share(a))
    .slice(0, limit)
    .map(({ recipe, have, missing }) => ({ recipe, have, missing }));
}
