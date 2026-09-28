import { describe, expect, it } from 'vitest';
import { matchesQuery } from '../search';
import { recipe } from './helpers';

const curry = recipe('Gochujang Chicken Curry', ['chicken thighs', 'onion', 'rice'], { tags: ['Dinner', 'Spicy'] });
const pasta = recipe('Creamy Mushroom Pasta', ['mushrooms', 'cream', 'minced garlic'], { tags: ['Dinner'] });
const fruit = recipe('Quick Fruit Protein Bowl', ['strawberries', 'protein powder'], { tags: ['Breakfast'] });
const kipDutch = recipe('Kippendijen uit de oven', ['kipfilet', 'gehakte ui']);

describe('matchesQuery', () => {
  it('finds English recipes with Dutch words', () => {
    expect(matchesQuery(curry, 'kip')).toBe(true);
    expect(matchesQuery(curry, 'rijst')).toBe(true);
    expect(matchesQuery(fruit, 'aardbeien')).toBe(true);
  });

  it('finds Dutch recipes with English words', () => {
    expect(matchesQuery(kipDutch, 'chicken')).toBe(true);
  });

  it('ignores word order', () => {
    expect(matchesQuery(curry, 'kip curry')).toBe(true);
    expect(matchesQuery(curry, 'curry kip')).toBe(true);
  });

  it('requires every word to match', () => {
    expect(matchesQuery(curry, 'kip pasta')).toBe(false);
  });

  it('does not match short words inside other words', () => {
    expect(matchesQuery(fruit, 'ui')).toBe(false); // "fruit", "quick"
    expect(matchesQuery(fruit, 'ei')).toBe(false); // "protein"
    expect(matchesQuery(pasta, 'room')).toBe(true); // via "cream"
    expect(matchesQuery(recipe('Mushroom toast', ['mushrooms']), 'room')).toBe(false);
  });

  it('does not treat "minced garlic" as minced meat', () => {
    expect(matchesQuery(pasta, 'gehakt')).toBe(false);
  });

  it('finds minced meat but not chopped vegetables for "gehakt"', () => {
    expect(matchesQuery(recipe('Soep', ['courgette', 'gehakte ui', 'peterselie, fijn gehakt']), 'gehakt')).toBe(false);
    expect(matchesQuery(recipe('Lasagne', ['rundergehakt']), 'gehakt')).toBe(true);
    expect(matchesQuery(recipe('Pasta', ['gehakt', 'tomaat']), 'gehakt')).toBe(true);
  });

  it('ignores accents and case', () => {
    expect(matchesQuery(recipe('Crème brûlée', ['cream']), 'CREME brulee')).toBe(true);
  });

  it('finds labels by their Dutch names', () => {
    expect(matchesQuery(fruit, 'ontbijt')).toBe(true);
    expect(matchesQuery(curry, 'pittig')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery(curry, '   ')).toBe(true);
  });
});
