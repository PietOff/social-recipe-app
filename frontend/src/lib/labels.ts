import { Recipe } from '../types';

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

export type LabelKind = 'time' | 'protein' | 'method' | 'effort' | 'tag';

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
// a good share of the source videos are Dutch.
const PROTEIN_TERMS: Array<[string, string[]]> = [
  ['Chicken', ['chicken', 'kip', 'poultry', 'turkey', 'kalkoen']],
  ['Beef', ['beef', 'rund', 'steak', 'biefstuk', 'mince', 'gehakt', 'brisket']],
  ['Pork', ['pork', 'varken', 'bacon', 'spek', 'ham', 'chorizo', 'sausage', 'worst']],
  ['Fish', ['fish', 'vis', 'salmon', 'zalm', 'tuna', 'tonijn', 'cod', 'kabeljauw']],
  ['Seafood', ['shrimp', 'prawn', 'garnaal', 'garnalen', 'squid', 'inktvis', 'mussel', 'mossel']],
  ['Lamb', ['lamb', 'lamsvlees']],
];

const MEAT_TERMS = PROTEIN_TERMS.flatMap(([, terms]) => terms);

const METHOD_TERMS: Array<[string, string[]]> = [
  ['Airfryer', ['airfryer', 'air fryer', 'heteluchtfriteuse']],
  ['BBQ / grill', ['bbq', 'barbecue', 'grill', 'grillen', 'braai', 'smoker']],
  ['Oven', ['oven', 'bake', 'baked', 'roast', 'roasted', 'bakken', 'braden']],
  ['Slow cooker', ['slow cooker', 'crockpot', 'slowcooker', 'sous vide']],
  ['No cook', ['no-cook', 'no cook', 'geen oven', 'raw']],
];

function haystack(recipe: Recipe): string {
  return [
    recipe.title,
    recipe.description,
    ...(recipe.tags || []),
    recipe.category || '',
    ...(recipe.ingredients || []).map(i => i?.item || ''),
  ]
    .join(' ')
    .toLowerCase();
}

function matchFirst(text: string, table: Array<[string, string[]]>): string | null {
  for (const [label, terms] of table) {
    if (terms.some(term => text.includes(term))) return label;
  }
  return null;
}

function methodLabel(recipe: Recipe): string | null {
  const instructions = (recipe.instructions || []).join(' ').toLowerCase();
  return matchFirst(haystack(recipe) + ' ' + instructions, METHOD_TERMS);
}

function proteinLabel(recipe: Recipe): string | null {
  const text = haystack(recipe);
  const protein = matchFirst(text, PROTEIN_TERMS);
  if (protein) return protein;
  // Only claim "Vegetarian" when there is something to go on: an empty
  // ingredient list is unknown, not meat-free.
  if ((recipe.ingredients || []).length > 0 && !MEAT_TERMS.some(t => text.includes(t))) {
    return 'Vegetarian';
  }
  return null;
}

function effortLabels(recipe: Recipe): string[] {
  const out: string[] = [];
  const count = (recipe.ingredients || []).length;
  if (count > 0 && count <= 5) out.push('5 ingredients or fewer');
  const steps = (recipe.instructions || []).join(' ').toLowerCase();
  if (/one[- ]pan|one[- ]pot|sheet pan|single pan|één pan|traybake/.test(steps + ' ' + haystack(recipe))) {
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
  ];
  for (const [value, kind] of derived) {
    if (value) labels.push({ value, kind });
  }
  for (const value of effortLabels(recipe)) {
    labels.push({ value, kind: 'effort' });
  }

  // Case-insensitive de-dupe, keeping the first spelling seen.
  const seen = new Set<string>();
  return labels.filter(label => {
    const key = label.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function labelValues(recipe: Recipe): string[] {
  return recipeLabels(recipe).map(l => l.value);
}

export function hasLabel(recipe: Recipe, value: string): boolean {
  const needle = value.toLowerCase();
  return labelValues(recipe).some(v => v.toLowerCase() === needle);
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
      const key = label.value.toLowerCase();
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
