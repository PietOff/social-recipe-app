import { describe, expect, it } from 'vitest';
import { pantryMatches, parseHave } from '../pantry';
import { recipe } from './helpers';

const omelette = recipe('Omelette', ['eggs', 'butter', 'salt', 'pepper', 'cheese', 'fresh chives']);
const rice = recipe('Simple steamed rice', ['rice', 'water', 'salt']);
const curry = recipe('Chicken curry', ['chicken thighs', 'onion', 'coconut milk', 'curry paste', 'rice', 'olive oil']);
const pasta = recipe('Pasta pesto met kip', ['pasta', 'kipfilet', 'pesto', 'parmezaan', 'zout']);
const salad = recipe('Tomato salad', ['tomatoes', 'red onion', 'cucumber', 'extra-virgin olive oil', 'salt', 'dried oregano']);
const book = [omelette, curry, pasta, salad, rice];

describe('parseHave', () => {
  it('splits on commas, new lines and "and"/"en"', () => {
    expect(parseHave('kip, rijst en ui\ncocosmelk')).toEqual(['kip', 'rijst', 'ui', 'cocosmelk']);
  });
});

describe('pantryMatches', () => {
  it('finds English recipes from Dutch ingredients and lists what is missing', () => {
    const [top, ...rest] = pantryMatches(book, 'kip, rijst, ui, kokosmelk');
    expect(top.recipe.title).toBe('Chicken curry');
    expect(top.missing.map(i => i.item)).toEqual(['curry paste']);
    expect(rest.map(m => m.recipe.title)).toContain('Pasta pesto met kip');
  });

  it('never counts salt, pepper, oil or sugar as missing', () => {
    const m = pantryMatches(book, 'tomaten, rode ui').find(x => x.recipe.title === 'Tomato salad')!;
    expect(m.missing.map(i => i.item)).toEqual(['cucumber']);
  });

  it('ranks the recipe you can make completely first', () => {
    expect(pantryMatches(book, 'eieren, boter, kaas, kip')[0].recipe.title).toBe('Omelette');
  });

  it('leaves out recipes that use none of it', () => {
    expect(pantryMatches(book, 'zalm')).toEqual([]);
    expect(pantryMatches(book, '')).toEqual([]);
  });

  it('reads a described ingredient by its noun', () => {
    const titles = pantryMatches(book, 'rode ui').map(m => m.recipe.title);
    expect(titles[0]).toBe('Tomato salad');
    expect(titles).toContain('Chicken curry');
  });

  it('leaves out tiny recipes and does not count herbs as missing', () => {
    const titles = pantryMatches(book, 'rijst, eieren, kaas, boter').map(m => m.recipe.title);
    expect(titles).not.toContain('Simple steamed rice');
    expect(pantryMatches(book, 'eieren, kaas, boter')[0].missing).toEqual([]);
  });

  it('puts recipes that use more of what you named first', () => {
    // The curry uses chicken, rice and onion; the pasta only chicken.
    const titles = pantryMatches(book, 'kip, rijst, ui').map(m => m.recipe.title);
    expect(titles.indexOf('Chicken curry')).toBeLessThan(titles.indexOf('Pasta pesto met kip'));
  });

  it('ignores preparation notes when matching', () => {
    const prawns = recipe('Gambas', ['prawns, peeled and deveined', 'garlic, thinly sliced', 'white wine']);
    expect(pantryMatches([prawns], 'garnalen')[0].missing.map(i => i.item)).toEqual(['garlic, thinly sliced', 'white wine']);
  });
});
