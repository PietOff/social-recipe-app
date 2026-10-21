import { describe, expect, it } from 'vitest';
import { Recipe, RecipeText } from '../../types';
import { asEdited, localized, needsTranslation, recipeText, withTranslation } from '../translate';

const recipe: Recipe = {
  id: 'u_1',
  title: 'Sausage Ragu Bianco',
  description: 'A creamy white ragu.',
  ingredients: [{ item: 'Italian sausage', amount: '500', unit: 'g', group: 'Main' }],
  instructions: ['Brown the sausage.'],
  servings: '4 people',
  tags: ['Pasta'],
  source_url: 'https://www.tiktok.com/@x/video/1',
  language: 'en',
};

const dutch: RecipeText = {
  title: 'Ragu bianco met worst',
  description: 'Een romige witte ragu.',
  ingredients: [{ item: 'Italiaanse worst', amount: '500', unit: 'g', group: 'Main' }],
  instructions: ['Bak de worst bruin.'],
  servings: '4 personen',
};

describe('recipe translation', () => {
  it('shows the original in its own language', () => {
    expect(localized(recipe, 'en')).toBe(recipe);
    expect(needsTranslation(recipe, 'en')).toBe(false);
  });

  it('needs a translation for the other language until one is cached', () => {
    expect(needsTranslation(recipe, 'nl')).toBe(true);
    expect(localized(recipe, 'nl').title).toBe('Sausage Ragu Bianco');
    const cached = withTranslation(recipe, 'nl', dutch);
    expect(needsTranslation(cached, 'nl')).toBe(false);
    const shown = localized(cached, 'nl');
    expect(shown.title).toBe('Ragu bianco met worst');
    expect(shown.instructions).toEqual(['Bak de worst bruin.']);
    expect(shown.servings).toBe('4 personen');
  });

  it('keeps identity, tags and links when showing a translation', () => {
    const shown = localized(withTranslation(recipe, 'nl', dutch), 'nl');
    expect(shown.id).toBe('u_1');
    expect(shown.tags).toEqual(['Pasta']);
    expect(shown.source_url).toBe(recipe.source_url);
    expect(shown.language).toBe('en');
  });

  it('treats older recipes without a language as needing translation', () => {
    const old = { ...recipe, language: undefined };
    expect(needsTranslation(old, 'nl')).toBe(true);
    expect(needsTranslation(old, 'en')).toBe(true);
  });

  it('does not translate an empty extraction', () => {
    expect(needsTranslation({ ...recipe, ingredients: [], instructions: [] }, 'nl')).toBe(false);
  });

  it('drops stale translations after an edit', () => {
    const edited = asEdited(withTranslation(recipe, 'nl', dutch), 'nl');
    expect(edited.language).toBe('nl');
    expect(edited.translations).toBeUndefined();
  });

  it('extracts only the language-dependent fields', () => {
    expect(Object.keys(recipeText(recipe)).sort()).toEqual(
      ['cook_time', 'description', 'ingredients', 'instructions', 'prep_time', 'servings', 'title'],
    );
  });
});
