import { Recipe, RecipeLang, RecipeText } from '../types';
import { apiPost } from './api';

/**
 * Recipes in the reader's language.
 *
 * A recipe is written in the UI language at the moment it is extracted. When
 * it is opened in the other language, the text is translated once by the
 * backend and kept on the recipe under `translations[lang]`, so later views,
 * other devices and the cookbook list reuse it. Tags, amounts, links and the
 * recipe's identity never change.
 */

export function recipeText(r: Recipe): RecipeText {
  return {
    title: r.title || '',
    description: r.description || '',
    ingredients: r.ingredients || [],
    instructions: r.instructions || [],
    prep_time: r.prep_time ?? null,
    cook_time: r.cook_time ?? null,
    servings: r.servings ?? null,
  };
}

/** The recipe with its text in `lang` when that is known; otherwise unchanged. */
export function localized(r: Recipe, lang: RecipeLang): Recipe {
  if (r.language === lang) return r;
  const text = r.translations?.[lang];
  if (!text) return r;
  return {
    ...r,
    title: text.title || r.title,
    description: text.description ?? r.description,
    ingredients: text.ingredients?.length ? text.ingredients : r.ingredients,
    instructions: text.instructions?.length ? text.instructions : r.instructions,
    prep_time: text.prep_time ?? r.prep_time,
    cook_time: text.cook_time ?? r.cook_time,
    servings: text.servings ?? r.servings,
  };
}

/** True when showing the recipe in `lang` still needs a translation. */
export function needsTranslation(r: Recipe, lang: RecipeLang): boolean {
  if (r.language === lang || r.translations?.[lang]) return false;
  // Nothing to translate in an empty or failed extraction.
  return Boolean(r.ingredients?.length || r.instructions?.length);
}

export function withTranslation(r: Recipe, lang: RecipeLang, text: RecipeText): Recipe {
  return { ...r, translations: { ...(r.translations || {}), [lang]: text } };
}

/** An edited recipe: what was edited is the text in `lang`, so older
 *  translations no longer match it and are dropped. */
export function asEdited(r: Recipe, lang: RecipeLang): Recipe {
  const next: Recipe = { ...r, language: lang };
  delete next.translations;
  return next;
}

export async function fetchTranslation(r: Recipe, lang: RecipeLang): Promise<RecipeText> {
  const result = await apiPost<RecipeText & { language?: string }>('/translate-recipe', {
    recipe: recipeText(r),
    language: lang,
  });
  return {
    title: result.title,
    description: result.description,
    ingredients: result.ingredients,
    instructions: result.instructions,
    prep_time: result.prep_time ?? null,
    cook_time: result.cook_time ?? null,
    servings: result.servings ?? null,
  };
}
