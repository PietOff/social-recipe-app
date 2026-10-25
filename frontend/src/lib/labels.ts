import { Recipe } from '../types';
import { normalize, startsWord } from './text';

/**
 * Labels derived from a recipe's own content.
 *
 * Tags on a recipe are whatever the extraction model happened to emit, so they
 * are uneven across a cookbook built up over months - and the filter row used to
 * be a fixed list of ~34 chips shown regardless of what was actually saved, so
 * most of them matched nothing. These labels are computed from fields every
 * recipe already has, which means they apply retroactively to the whole
 * cookbook without re-extracting anything.
 */

export type LabelKind = 'time' | 'protein' | 'method' | 'effort' | 'cuisine' | 'tag';

/** Case-, hyphen- and spacing-insensitive key: the extractor's "One-Pan" tag and
 *  the derived "One pan" label are the same label, not two chips. */
export function labelKey(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

export interface Label {
  value: string;
  kind: LabelKind;
}

/** Minutes expressed by strings like "1 hr 10 min", "45 minuten", "PT25M", "20". */
export function parseMinutes(raw?: string | null): number | null {
  if (!raw) return null;
  const text = String(raw).toLowerCase();

  const iso = text.match(/pt(?:(\d+)h)?(?:(\d+)m)?/);
  if (iso && (iso[1] || iso[2])) {
    return Number(iso[1] || 0) * 60 + Number(iso[2] || 0);
  }

  let minutes = 0;
  let matched = false;
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|hr|hour|uur)/);
  if (hours) {
    minutes += parseFloat(hours[1].replace(',', '.')) * 60;
    matched = true;
  }
  const mins = text.match(/(\d+)\s*(?:m\b|min|minute|minuten)/);
  if (mins) {
    minutes += Number(mins[1]);
    matched = true;
  }
  if (!matched) {
    const bare = text.match(/^\s*(\d+)\s*$/);
    if (bare) return Number(bare[1]);
    return null;
  }
  return Math.round(minutes);
}

export function totalMinutes(recipe: Recipe): number | null {
  const prep = parseMinutes(recipe.prep_time);
  const cook = parseMinutes(recipe.cook_time);
  if (prep === null && cook === null) return null;
  return (prep || 0) + (cook || 0);
}

function timeLabel(recipe: Recipe): string | null {
  const total = totalMinutes(recipe);
  if (total === null || total <= 0) return null;
  if (total <= 20) return 'Under 20 min';
  if (total <= 40) return 'Under 40 min';
  if (total <= 60) return 'About an hour';
  return 'Low & slow';
}

// Matched against title + tags + ingredient names. Dutch terms included because
// a good share of the source videos are Dutch. Terms match at the start of a
// word (see `matchFirst`), so no bare "mince" here: it tagged every recipe with
// "minced garlic" as beef.
const PROTEIN_TERMS: Array<[string, string[]]> = [
  ['Chicken', ['chicken', 'kip', 'poultry', 'turkey', 'kalkoen']],
  ['Beef', ['beef', 'rund', 'steak', 'biefstuk', 'minced beef', 'minced meat', 'ground beef', 'ground meat', 'gehaktbal', 'brisket']],
  ['Pork', ['pork', 'varken', 'bacon', 'spek', 'ham', 'chorizo', 'sausage', 'worst']],
  ['Fish', ['fish', 'vis', 'salmon', 'zalm', 'tuna', 'tonijn', 'cod', 'kabeljauw']],
  ['Seafood', ['shrimp', 'prawn', 'garnaal', 'garnalen', 'squid', 'inktvis', 'mussel', 'mossel']],
  ['Lamb', ['lamb', 'lamsvlees']],
];

// Meat that gets no label of its own but still rules out "Vegetarian" - without
// these, plain "meatballs" or "duck" came out vegetarian.
const MEAT_TERMS = [
  ...PROTEIN_TERMS.flatMap(([, terms]) => terms),
  'meat', 'vlees', 'veal', 'kalfs', 'duck', 'eend', 'venison', 'hert', 'salami',
  'pepperoni', 'prosciutto', 'pancetta', 'anchov', 'ansjovis', 'gelatin',
];

/**
 * Dutch "gehakt" is both minced meat ("500 g gehakt") and "chopped" ("gehakte
 * ui", "peterselie, fijn gehakt"), so it cannot be a plain term: every Dutch
 * recipe with chopped onion would be beef. It counts as meat only as the
 * ingredient itself - an ingredient that starts with the bare word.
 */
const MINCE_INGREDIENT = /^(?:half om half |runder|varkens|kalfs)?gehakt(?![\p{L}\p{N}])/u;

function hasMinceIngredient(recipe: Recipe): boolean {
  return (recipe.ingredients || []).some(i => MINCE_INGREDIENT.test(normalize(i?.item || '').trim()));
}

const METHOD_TERMS: Array<[string, string[]]> = [
  ['Airfryer', ['airfryer', 'air fryer', 'heteluchtfriteuse']],
  ['BBQ / grill', ['bbq', 'barbecue', 'grill', 'grillen', 'braai', 'smoker']],
  ['Oven', ['oven', 'bake', 'baking', 'roast', 'bakken', 'braden']],
  ['Slow cooker', ['slow cooker', 'crockpot', 'slowcooker', 'sous vide']],
  ['No cook', ['no-cook', 'no cook', 'geen oven', 'raw']],
];

/** Words that start like a meat term but are not meat: a "vleestomaat" is a
 *  tomato, not meat ("vlees"). They are blanked out before matching. */
const FALSE_FRIENDS = /(^|[^\p{L}\p{N}])vleestoma(?:at|ten)(?![\p{L}\p{N}])/gu;

function haystack(recipe: Recipe): string {
  const text = [
    recipe.title,
    recipe.description,
    ...(recipe.tags || []),
    recipe.category || '',
    ...(recipe.ingredients || []).map(i => i?.item || ''),
  ]
    .join(' ');
  return normalize(text).replace(FALSE_FRIENDS, '$1 ');
}

/**
 * First label whose terms start a word in `text`. Word starts rather than
 * substrings: "raw" used to match "strawberry" (so strawberry desserts were
 * "No cook") and "ham" matched "champignon". Prefixes still catch plurals and
 * Dutch compounds ("kip" in "kipfilet", "grill" in "grilled").
 */
function matchFirst(text: string, table: Array<[string, string[]]>): string | null {
  for (const [label, terms] of table) {
    if (terms.some(term => startsWord(text, term))) return label;
  }
  return null;
}

/**
 * Cuisines, recognised from what a recipe is rather than from a tag: nobody
 * writes "Mexican" on a burrito, so a search for "mexico" found nothing.
 *
 * `names` are the cuisine named outright ("Mexican", "Mexicaans"); `dishes` are
 * dishes that belong to it; `markers` are ingredients that only show up in it.
 * Names and dishes are read from the title, description and tags; markers from
 * the ingredients. Generic things that cross cuisines (tortilla wraps, salsa,
 * pasta salad, curry, soy sauce) are left out on purpose.
 */
interface Cuisine { label: string; names: string[]; dishes: string[]; markers: string[] }

const CUISINES: Cuisine[] = [
  { label: 'Mexican', names: ['mexican', 'mexicaans', 'mexicaanse', 'mexico', 'tex mex'],
    dishes: ['burrito', 'taco', 'tacos', 'quesadilla', 'enchilada', 'fajita', 'nacho', 'guacamole',
      'chimichanga', 'tostada', 'tamale', 'pozole', 'elote', 'chili con carne', 'carnitas', 'birria',
      'mole', 'huevos rancheros', 'pico de gallo', 'al pastor', 'barbacoa', 'chilaquiles', 'crunchwrap',
      'crunch wrap supreme', 'taquito'],
    // Not chipotle or jalapeño: they turn up in Cajun pasta, corn ribs and
    // breakfast muffins far more often than in anything Mexican.
    markers: ['taco seasoning', 'tacokruiden', 'fajitakruiden', 'tomatillo',
      'cotija', 'queso fresco', 'enchilada sauce'] },
  { label: 'Italian', names: ['italian', 'italiaans', 'italiaanse', 'italie'],
    dishes: ['pizza', 'risotto', 'lasagna', 'lasagne', 'carbonara', 'bolognese', 'gnocchi', 'pesto',
      'tiramisu', 'focaccia', 'arancini', 'ossobuco', 'parmigiana', 'saltimbocca', 'cacio e pepe',
      'ragu', 'panna cotta', 'bruschetta', 'cannelloni', 'ravioli', 'tortellini', 'puttanesca',
      'arrabbiata', 'amatriciana', 'aglio e olio', 'minestrone', 'caprese', 'piccata', 'scaloppine'],
    markers: ['mascarpone', 'guanciale'] },
  { label: 'Chinese', names: ['chinese', 'chinees', 'china'],
    dishes: ['dim sum', 'kung pao', 'char siu', 'chow mein', 'mapo tofu', 'sweet and sour', 'zoetzuur',
      'peking', 'szechuan', 'sichuan', 'wonton', 'lo mein', 'general tso', 'bao', 'baozi',
      'babi pangang', 'foe yong hai', 'tjap tjoy', 'chop suey', 'egg fried rice'],
    markers: ['shaoxing', 'doubanjiang', 'five spice', 'vijfkruidenpoeder', 'sichuan pepper'] },
  { label: 'Japanese', names: ['japanese', 'japans', 'japanse', 'japan'],
    dishes: ['sushi', 'ramen', 'teriyaki', 'gyoza', 'katsu', 'tempura', 'udon', 'onigiri', 'yakitori',
      'okonomiyaki', 'donburi', 'karaage', 'tonkatsu', 'yakisoba', 'miso soup', 'misosoep'],
    markers: ['dashi', 'nori', 'furikake'] },
  { label: 'Korean', names: ['korean', 'koreaans', 'koreaanse', 'korea'],
    dishes: ['kimchi', 'bibimbap', 'bulgogi', 'tteokbokki', 'japchae', 'korean fried chicken'],
    markers: ['gochujang', 'gochugaru'] },
  { label: 'Thai', names: ['thai', 'thais', 'thaise', 'thailand'],
    dishes: ['pad thai', 'tom yum', 'tom kha', 'green curry', 'groene curry', 'red curry', 'rode curry',
      'massaman', 'larb', 'pad kra pao', 'panang', 'khao pad'],
    markers: ['thai basil', 'thaise basilicum', 'thai curry paste', 'thaise currypasta'] },
  { label: 'Vietnamese', names: ['vietnamese', 'vietnamees', 'vietnam'],
    dishes: ['pho', 'banh mi', 'bun cha', 'bun bo'], markers: [] },
  { label: 'Indian', names: ['indian', 'indiaas', 'indiase', 'india'],
    dishes: ['tikka', 'masala', 'korma', 'dal', 'dahl', 'daal', 'biryani', 'naan', 'butter chicken',
      'vindaloo', 'paneer', 'samosa', 'chana', 'aloo', 'tandoori', 'rogan josh', 'saag', 'pakora',
      'bhaji', 'jalfrezi', 'madras', 'dhal', 'raita', 'chapati'],
    markers: ['garam masala'] },
  { label: 'Indonesian', names: ['indonesian', 'indonesisch', 'indonesische', 'indisch', 'indische'],
    dishes: ['nasi', 'bami', 'rendang', 'sate', 'satay', 'saté', 'gado gado', 'ayam', 'babi ketjap',
      'opor', 'soto', 'rijsttafel', 'lumpia', 'loempia', 'atjar', 'seroendeng'],
    // Not sambal or ketjap manis: Dutch kitchens put those in everything.
    markers: ['boemboe', 'bumbu', 'trassi', 'sereh', 'djahe', 'laos'] },
  { label: 'Middle Eastern', names: ['middle eastern', 'midden oosters', 'midden oosterse', 'lebanese', 'libanees', 'israeli'],
    dishes: ['shakshuka', 'hummus', 'falafel', 'shawarma', 'tabbouleh', 'baba ganoush', 'labneh',
      'fattoush', 'manakish', 'mezze', 'meze', 'musakhan', 'mujadara'],
    markers: ['tahini', 'tahin', 'zaatar', 'sumac', 'sumak'] },
  { label: 'Turkish', names: ['turkish', 'turks', 'turkse', 'turkije'],
    dishes: ['kebab', 'doner', 'lahmacun', 'pide', 'borek', 'kofte', 'menemen', 'iskender', 'manti', 'baklava'],
    markers: ['pul biber'] },
  { label: 'Greek', names: ['greek', 'grieks', 'griekse', 'griekenland'],
    dishes: ['gyros', 'souvlaki', 'tzatziki', 'moussaka', 'spanakopita', 'pastitsio', 'stifado',
      'kleftiko', 'dolmades', 'horiatiki', 'greek salad'], markers: [] },
  { label: 'Moroccan', names: ['moroccan', 'marokkaans', 'marokkaanse', 'marokko', 'north african', 'noord afrikaans'],
    dishes: ['tagine', 'tajine', 'couscous', 'harira', 'pastilla', 'msemen', 'zaalouk'],
    markers: ['ras el hanout', 'harissa', 'preserved lemon'] },
  { label: 'Spanish', names: ['spanish', 'spaans', 'spaanse', 'spanje'],
    dishes: ['paella', 'tapas', 'patatas bravas', 'gazpacho', 'croquetas', 'tortilla espanola',
      'tortilla de patatas', 'albondigas', 'gambas al ajillo', 'pimientos de padron', 'salmorejo', 'churros'],
    markers: [] },
  { label: 'French', names: ['french', 'frans', 'franse', 'frankrijk'],
    dishes: ['ratatouille', 'quiche', 'croque', 'coq au vin', 'bourguignon', 'crepe', 'souffle',
      'tarte tatin', 'gratin dauphinois', 'bouillabaisse', 'cassoulet', 'beurre blanc',
      'bearnaise', 'nicoise', 'clafoutis', 'creme brulee', 'tartiflette', 'croissant', 'galette'],
    markers: ['herbes de provence'] },
  { label: 'Dutch', names: ['dutch', 'hollands', 'hollandse', 'nederlands', 'nederlandse', 'brabants', 'brabantse'],
    dishes: ['stamppot', 'hutspot', 'erwtensoep', 'snert', 'bitterbal', 'kroket', 'poffertjes', 'hachee',
      'zuurkool', 'boerenkool', 'worstenbrood', 'oliebol', 'appeltaart', 'draadjesvlees', 'kapsalon',
      'pannenkoek', 'stroopwafel', 'speculaas', 'balkenbrij', 'andijviestamppot', 'jachtschotel'],
    markers: ['rookworst'] },
  { label: 'American', names: ['american', 'amerikaans', 'amerikaanse', 'southern'],
    dishes: ['mac and cheese', 'mac n cheese', 'pulled pork', 'sloppy joe', 'buffalo wings', 'cornbread',
      'philly cheesesteak', 'cheesesteak', 'smash burger', 'smashburger', 'meatloaf', 'pancakes and syrup',
      'clam chowder', 'jambalaya', 'gumbo', 'biscuits and gravy', 'chicken and waffles'],
    markers: [] },
];

/**
 * Cuisine words that name an ingredient, not a dish: Greek yogurt, French
 * fries, Italian seasoning, Spanish paprika, American cheese. And "butter
 * chicken" inside "honey/garlic/cowboy butter chicken", which is not the
 * Indian dish. These are blanked out before matching.
 */
const NOT_A_CUISINE = new RegExp([
  'italian (?:seasoning|herbs?|kruiden|sausages?|bread|dressing|style seasoning)',
  'italiaanse (?:kruiden|worst)',
  'french (?:fries|fried|toast|onion|mustard|dressing|bread|baguette|beans)',
  'franse (?:frietjes|mosterd|kaas)',
  'spanish (?:paprika|onions?|chorizo|olives?|rosemary|sea salt|salt)',
  'spaanse (?:paprika|peper|ui)',
  'greek (?:yogh?urt|seasoning|style yogh?urt)', 'griekse yogh?urt',
  'american (?:cheese|mustard)',
  'chinese (?:five spice|cabbage|leaf|broccoli|chives|sausage)', 'chinese kool',
  'korean (?:chili flakes|chilli flakes|pepper flakes)',
  'thai (?:chill?i(?:es|s)?|sweet chill?i)', 'japanese (?:mayo|mayonnaise|cucumber|breadcrumbs|panko)',
  'mexican (?:seasoning|spices?|cheese|oregano)', 'mexicaanse kruiden',
  'indian (?:spices?|curry powder)',
  '(?:honey|garlic|cowboy|lemon|brown|hot honey|hot) butter chicken',
].map(p => `(?:^|[^\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`).join('|'), 'gu');

function blankIngredientWords(text: string): string {
  return text.replace(NOT_A_CUISINE, ' ');
}

/** Short names ("dal", "pho", "sate") only as a whole word, so "photo",
 *  "dalgona" and "saten" stay out; longer ones also catch plurals and
 *  compounds ("burritos", "tikkamasala"). */
function hasTerm(text: string, term: string): boolean {
  const t = normalize(term);
  if (t.length <= 4) return new RegExp(`(?:^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![\\p{L}\\p{N}])`, 'u').test(text);
  return startsWord(text, t);
}

export function cuisineLabel(recipe: Recipe): string | null {
  const about = blankIngredientWords(normalize([recipe.title, recipe.description, ...(recipe.tags || []), recipe.category || ''].join(' ')));
  // Tags come from a fixed list ("Pizza", "Tacos"), so a dish there is reliable;
  // a dish mentioned in passing in a description ("great as a pizza base") is not.
  const titleAndTags = blankIngredientWords(normalize([recipe.title, ...(recipe.tags || []), recipe.category || ''].join(' ')));
  const title = blankIngredientWords(normalize(recipe.title || ''));
  const ingredients = normalize((recipe.ingredients || []).map(i => i?.item || '').join(' '));
  // Named outright in the title wins ("Korean fried chicken tacos" is Korean),
  // then a known dish in the title, then the cuisine named in the description
  // or tags, then a dish in the tags, then a telltale ingredient.
  const passes: Array<(c: Cuisine) => boolean> = [
    c => c.names.some(n => hasTerm(title, n)),
    c => c.dishes.some(d => hasTerm(title, d)),
    c => c.names.some(n => hasTerm(about, n)),
    c => c.dishes.some(d => hasTerm(titleAndTags, d)),
    c => c.markers.some(m => hasTerm(ingredients, m)),
  ];
  for (const pass of passes) {
    const hit = CUISINES.find(pass);
    if (hit) return hit.label;
  }
  return null;
}

function methodLabel(recipe: Recipe): string | null {
  const instructions = normalize((recipe.instructions || []).join(' '));
  return matchFirst(haystack(recipe) + ' ' + instructions, METHOD_TERMS);
}

function proteinLabel(recipe: Recipe): string | null {
  const text = haystack(recipe);
  const protein = matchFirst(text, PROTEIN_TERMS);
  if (protein) return protein;
  if (hasMinceIngredient(recipe)) return 'Beef';
  // Only claim "Vegetarian" when there is something to go on: an empty
  // ingredient list is unknown, not meat-free.
  if ((recipe.ingredients || []).length > 0 && !MEAT_TERMS.some(t => startsWord(text, t))) {
    return 'Vegetarian';
  }
  return null;
}

function effortLabels(recipe: Recipe): string[] {
  const out: string[] = [];
  const count = (recipe.ingredients || []).length;
  if (count > 0 && count <= 5) out.push('5 ingredients or fewer');
  // Normalised text has no accents or hyphens: "één pan" is "een pan" here.
  const steps = normalize((recipe.instructions || []).join(' '));
  if (/one pan|one pot|sheet pan|single pan|een pan|traybake/.test(steps + ' ' + haystack(recipe))) {
    out.push('One pan');
  }
  return out;
}

/** Every label for a recipe: its own tags first, then the derived ones. */
export function recipeLabels(recipe: Recipe): Label[] {
  const own = recipe.tags && recipe.tags.length > 0
    ? recipe.tags
    : recipe.category
      ? [recipe.category]
      : [];

  const labels: Label[] = own.filter(Boolean).map(value => ({ value, kind: 'tag' as const }));

  const derived: Array<[string | null, LabelKind]> = [
    [timeLabel(recipe), 'time'],
    [proteinLabel(recipe), 'protein'],
    [methodLabel(recipe), 'method'],
    [cuisineLabel(recipe), 'cuisine'],
  ];
  for (const [value, kind] of derived) {
    if (value) labels.push({ value, kind });
  }
  for (const value of effortLabels(recipe)) {
    labels.push({ value, kind: 'effort' });
  }

  // De-dupe on labelKey, keeping the first spelling seen.
  const seen = new Set<string>();
  return labels.filter(label => {
    const key = labelKey(label.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function labelValues(recipe: Recipe): string[] {
  return recipeLabels(recipe).map(l => l.value);
}

export function hasLabel(recipe: Recipe, value: string): boolean {
  const needle = labelKey(value);
  return labelValues(recipe).some(v => labelKey(v) === needle);
}

export interface LabelFacet {
  value: string;
  kind: LabelKind;
  count: number;
}

/**
 * The filter row, built from what is actually in the cookbook and ordered by how
 * many recipes each label covers - so every chip shown returns something.
 */
export function labelFacets(recipes: Recipe[], minCount = 2): LabelFacet[] {
  const counts = new Map<string, LabelFacet>();

  for (const recipe of recipes) {
    for (const label of recipeLabels(recipe)) {
      const key = labelKey(label.value);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { value: label.value, kind: label.kind, count: 1 });
    }
  }

  // A one-off label is noise in a large cookbook but is all you have in a small
  // one, so the threshold only applies once there is enough to filter.
  const threshold = recipes.length >= 12 ? minCount : 1;

  return [...counts.values()]
    .filter(facet => facet.count >= threshold)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
