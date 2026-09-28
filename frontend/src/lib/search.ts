import { Recipe } from '../types';
import { labelSpellings } from './i18n';
import { labelValues } from './labels';
import { containsTerm, normalize } from './text';

/**
 * Bilingual cookbook search.
 *
 * Recipes are stored in English (the extractor translates), but people search in
 * Dutch as often as not - so a query word is expanded to every term in its
 * synonym group before matching. Each group is one concept in both languages,
 * singular and plural. Terms are written without accents; `normalize` strips
 * them from both sides. See `containsTerm` for how short words are matched.
 */
const SYNONYM_GROUPS: string[][] = [
  // Meat & fish
  ['chicken', 'kip', 'kippen', 'poultry', 'gevogelte'],
  ['chicken breast', 'kipfilet', 'kippenborst', 'kippenfilet'],
  ['chicken thigh', 'chicken thighs', 'kippendij', 'kippendijen', 'dijfilet'],
  ['turkey', 'kalkoen'],
  ['beef', 'rund', 'rundvlees', 'runder'],
  ['steak', 'biefstuk', 'entrecote', 'ribeye'],
  // No bare "mince": it would match "minced garlic".
  ['minced beef', 'minced meat', 'minced pork', 'beef mince', 'pork mince', 'ground beef', 'ground meat', 'ground pork', 'gehakt', 'rundergehakt', 'half om half'],
  ['meat', 'vlees'],
  ['pork', 'varken', 'varkensvlees', 'varkenshaas'],
  ['pork belly', 'buikspek'],
  ['bacon', 'spek', 'spekjes', 'pancetta'],
  ['ham', 'hammetje'],
  ['sausage', 'sausages', 'worst', 'worstjes', 'braadworst'],
  ['lamb', 'lam', 'lamsvlees', 'lamskotelet'],
  ['fish', 'vis', 'visfilet'],
  ['salmon', 'zalm'],
  ['tuna', 'tonijn'],
  ['cod', 'kabeljauw'],
  ['shrimp', 'shrimps', 'prawn', 'prawns', 'garnaal', 'garnalen', 'scampi'],
  ['mussel', 'mussels', 'mossel', 'mosselen'],
  ['squid', 'calamari', 'inktvis'],
  ['seafood', 'zeevruchten'],

  // Dairy, eggs, pantry
  ['egg', 'eggs', 'ei', 'eieren'],
  ['cheese', 'kaas'],
  ['parmesan', 'parmezaan', 'parmigiano'],
  ['goat cheese', 'geitenkaas'],
  ['milk', 'melk'],
  ['cream', 'room', 'slagroom', 'kookroom'],
  ['sour cream', 'zure room'],
  ['butter', 'boter', 'roomboter'],
  ['yogurt', 'yoghurt'],
  ['bread', 'brood'],
  ['flour', 'bloem', 'meel'],
  ['sugar', 'suiker'],
  ['honey', 'honing'],
  ['rice', 'rijst', 'risotto'],
  ['pasta', 'spaghetti', 'penne', 'macaroni', 'lasagna', 'lasagne', 'tagliatelle'],
  ['noodles', 'noodle', 'noedels', 'mie'],
  ['oil', 'olie'],
  ['olive oil', 'olijfolie'],
  ['vinegar', 'azijn'],
  ['salt', 'zout'],
  ['pepper', 'peper'],
  ['soy sauce', 'sojasaus', 'ketjap'],
  ['coconut milk', 'kokosmelk'],
  ['nuts', 'noten'],
  ['peanut', 'peanuts', 'pinda', 'pindas', 'peanut butter', 'pindakaas'],
  ['chocolate', 'chocola', 'chocolade'],

  // Vegetables, fruit, herbs
  ['vegetable', 'vegetables', 'veggie', 'veggies', 'groente', 'groenten'],
  ['potato', 'potatoes', 'aardappel', 'aardappelen', 'aardappels', 'krieltjes'],
  ['fries', 'friet', 'patat', 'frietjes'],
  ['onion', 'onions', 'ui', 'uien', 'uitje', 'uitjes'],
  ['garlic', 'knoflook'],
  ['tomato', 'tomatoes', 'tomaat', 'tomaten'],
  ['bell pepper', 'paprika', 'paprikas'],
  ['chili', 'chilli', 'chilies', 'chillies', 'chilipeper', 'rode peper', 'lombok'],
  ['mushroom', 'mushrooms', 'champignon', 'champignons', 'paddenstoel', 'paddenstoelen'],
  ['carrot', 'carrots', 'wortel', 'wortels', 'wortelen', 'worteltjes'],
  ['spinach', 'spinazie'],
  ['broccoli'],
  ['cauliflower', 'bloemkool'],
  ['zucchini', 'courgette'],
  ['eggplant', 'aubergine'],
  ['cucumber', 'komkommer'],
  ['lettuce', 'sla', 'kropsla', 'ijsbergsla'],
  ['corn', 'mais', 'maiskolf'],
  ['beans', 'bonen', 'sperziebonen'],
  ['chickpeas', 'chickpea', 'kikkererwten'],
  ['lentils', 'linzen'],
  ['lemon', 'citroen'],
  ['lime', 'limoen'],
  ['apple', 'apples', 'appel', 'appels'],
  ['banana', 'bananas', 'banaan', 'bananen'],
  ['strawberry', 'strawberries', 'aardbei', 'aardbeien'],
  ['ginger', 'gember'],
  ['coriander', 'cilantro', 'koriander'],
  ['parsley', 'peterselie'],
  ['basil', 'basilicum'],

  // Dishes, meals, methods, qualities
  ['soup', 'soep'],
  ['salad', 'salade'],
  ['stew', 'stoofpot', 'stoofvlees', 'stoof'],
  ['sauce', 'saus'],
  ['sandwich', 'broodje', 'broodjes'],
  ['toastie', 'tosti'],
  ['cake', 'taart'],
  ['cookie', 'cookies', 'koekje', 'koekjes'],
  ['pancake', 'pancakes', 'pannenkoek', 'pannenkoeken'],
  ['breakfast', 'ontbijt'],
  ['lunch', 'middageten'],
  ['dinner', 'avondeten', 'diner', 'avondmaal'],
  ['dessert', 'toetje', 'nagerecht', 'nagerechten'],
  ['snack', 'snacks', 'tussendoortje', 'hapje', 'hapjes'],
  ['appetizer', 'starter', 'voorgerecht', 'voorgerechten'],
  ['side', 'side dish', 'bijgerecht', 'bijgerechten'],
  ['drink', 'drinks', 'drankje', 'drankjes'],
  ['vegetarian', 'vegetarisch', 'vega'],
  ['vegan', 'veganistisch', 'plantaardig'],
  ['healthy', 'gezond'],
  ['low carb', 'koolhydraatarm'],
  ['high protein', 'eiwitrijk', 'proteine'],
  ['quick', 'fast', 'snel', 'under 20 min', 'binnen 20 min'],
  ['spicy', 'pittig', 'scherp'],
  ['sweet', 'zoet'],
  ['traditional', 'traditioneel', 'klassiek'],
  ['airfryer', 'air fryer', 'hetelucht', 'heteluchtfriteuse'],
  ['bbq', 'barbecue', 'grill', 'grilled', 'grillen', 'gegrild', 'braai'],
  ['oven', 'ovenschotel'],
  ['baked', 'baking', 'bake', 'bakken', 'gebakken'],
  ['slow cooker', 'slowcooker', 'crockpot'],
  ['one pan', 'one pot', 'een pan', 'traybake'],
];

const GROUPS_BY_WORD: Map<string, string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const terms = group.map(normalize);
    for (const term of terms) {
      const set = map.get(term) ?? new Set<string>();
      terms.forEach(t => set.add(t));
      map.set(term, set);
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
})();

/** The word itself plus every synonym in either language. */
export function expandTerm(word: string): string[] {
  const w = normalize(word).trim();
  if (!w) return [];
  return [w, ...(GROUPS_BY_WORD.get(w) ?? []).filter(t => t !== w)];
}

/** Everything a search looks at for one recipe, normalised. Labels are
 *  included in both languages so a Dutch chip name finds its recipes. */
/**
 * "gehakt" is minced meat, but "gehakte ui" and "fijn gehakt" mean chopped.
 * Blanking the "chopped" forms keeps a search for gehakt from returning every
 * Dutch recipe with chopped onion, while "rundergehakt" still matches.
 */
const CHOPPED = /(^|[^\p{L}\p{N}])(?:fijn ?gehakte?|grof ?gehakte?|gehakte)(?![\p{L}\p{N}])/gu;

export function searchableText(recipe: Recipe): string {
  return normalize([
    recipe.title,
    recipe.description,
    ...labelValues(recipe).flatMap(labelSpellings),
    recipe.category || '',
    ...(recipe.ingredients || []).map(i => i?.item || ''),
  ].join(' ')).replace(CHOPPED, '$1 ');
}

/** Splits a query into words, keeping letters with accents together. */
export function queryWords(query: string): string[] {
  return normalize(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Every word of the query has to match something, each translated on its own,
 * so word order does not matter ("kip curry" == "curry chicken").
 */
export function matchesQuery(recipe: Recipe, query: string, text = searchableText(recipe)): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  return words.every(word => expandTerm(word).some(term => containsTerm(text, term)));
}
