import { Recipe } from '../../types';

/** A recipe with just the fields a test cares about. */
export function recipe(
  title: string,
  ingredients: string[] = [],
  extra: Partial<Recipe> = {},
): Recipe {
  return {
    title,
    description: '',
    ingredients: ingredients.map(item => ({ item })),
    instructions: [],
    ...extra,
  };
}
