import { Ingredient } from '../types';
import { Lang } from './i18n';
import { ingredientQuantity } from './recipes';
import { formatAmount, scaleIngredients } from './scale';
import { normalize } from './text';

/** A recipe on the shopping list, snapshotted when it was added. */
export interface ShoppingEntry {
  key: string;
  title: string;
  /** Scale factor chosen when it was added (2 = double the recipe). */
  factor: number;
  ingredients: Ingredient[];
}

export interface ShoppingList {
  entries: ShoppingEntry[];
  /** Item keys ticked off in the shop. */
  checked: string[];
}

export interface ShoppingItem {
  key: string;
  name: string;
  /** "600 g", "2 el", "naar smaak" - one per unit, summed where possible. */
  amounts: string[];
  recipes: string[];
}

export const EMPTY_LIST: ShoppingList = { entries: [], checked: [] };

const STORAGE_KEY = 'chefSocial_shopping';

export function loadShoppingList(): ShoppingList {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LIST;
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
      checked: Array.isArray(parsed?.checked) ? parsed.checked : [],
    };
  } catch {
    return EMPTY_LIST;
  }
}

export function saveShoppingList(list: ShoppingList): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/** Adds (or replaces, when the same recipe is added again) an entry. */
export function addEntry(list: ShoppingList, entry: ShoppingEntry): ShoppingList {
  return { ...list, entries: [...list.entries.filter(e => e.key !== entry.key), entry] };
}

export function removeEntry(list: ShoppingList, key: string): ShoppingList {
  return { ...list, entries: list.entries.filter(e => e.key !== key) };
}

export function toggleChecked(list: ShoppingList, itemKey: string): ShoppingList {
  const checked = list.checked.includes(itemKey)
    ? list.checked.filter(k => k !== itemKey)
    : [...list.checked, itemKey];
  return { ...list, checked };
}

const GLYPHS: Record<string, number> = { '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3 };

/**
 * "600g" -> { value: 600, unit: "g" }; "1½ el" and "1 1/2 el" -> 1.5 el.
 * Null for ranges and words, which are listed as they are.
 */
function parseQuantity(text: string): { value: number; unit: string } | null {
  const trimmed = text.trim();
  let value: number;
  let unit: string;
  const slash = trimmed.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)\s*(.*)$/);
  if (slash) {
    const [, whole, num, den, rest] = slash;
    if (!Number(den)) return null;
    value = (whole ? Number(whole) : 0) + Number(num) / Number(den);
    unit = rest;
  } else {
    const plain = trimmed.match(/^(\d+(?:[.,]\d+)?)?\s*([¼½¾⅓⅔])?\s*(.*)$/);
    if (!plain || (!plain[1] && !plain[2])) return null;
    value = (plain[1] ? Number(plain[1].replace(',', '.')) : 0) + (plain[2] ? GLYPHS[plain[2]] : 0);
    unit = plain[3];
  }
  if (/^[-–\/\d]/.test(unit)) return null; // a range or something we cannot read
  return { value, unit: unit.trim() };
}

function itemKey(item: string): string {
  return normalize(item).replace(/\s+/g, ' ').trim();
}

/**
 * The whole list as one set of items: the same ingredient from several
 * recipes appears once, with quantities of the same unit added up. Amounts
 * that are not a single number ("2-3", "naar smaak") are listed as they are.
 */
export function aggregate(list: ShoppingList, lang: Lang = 'en'): ShoppingItem[] {
  const items = new Map<string, {
    name: string;
    sums: Map<string, { unit: string; value: number }>;
    other: string[];
    recipes: Set<string>;
  }>();

  for (const entry of list.entries) {
    for (const ing of scaleIngredients(entry.ingredients, entry.factor, lang)) {
      const name = (ing.item || '').trim();
      if (!name) continue;
      const key = itemKey(name);
      let item = items.get(key);
      if (!item) {
        item = { name, sums: new Map(), other: [], recipes: new Set() };
        items.set(key, item);
      }
      item.recipes.add(entry.title);

      const text = ingredientQuantity(ing);
      if (!text) continue;
      const quantity = parseQuantity(text);
      if (quantity) {
        const unitKey = normalize(quantity.unit);
        const sum = item.sums.get(unitKey);
        if (sum) sum.value += quantity.value;
        else item.sums.set(unitKey, { ...quantity });
      } else if (!item.other.includes(text)) {
        item.other.push(text);
      }
    }
  }

  return [...items.entries()].map(([key, item]) => ({
    key,
    name: item.name,
    amounts: [
      ...[...item.sums.values()].map(s => [formatAmount(s.value, lang), s.unit].filter(Boolean).join(' ')),
      ...item.other,
    ],
    recipes: [...item.recipes],
  }));
}

/** Plain text for sharing or pasting into a notes app. */
export function toText(items: ShoppingItem[], checked: string[]): string {
  return items
    .map(item => `${checked.includes(item.key) ? '☑' : '☐'} ${[item.amounts.join(' + '), item.name].filter(Boolean).join(' ')}`)
    .join('\n');
}
