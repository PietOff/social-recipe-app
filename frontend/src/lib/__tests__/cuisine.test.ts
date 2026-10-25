import { describe, expect, it } from 'vitest';
import { cuisineLabel, labelFacets } from '../labels';
import { matchesQuery } from '../search';
import { prefilter } from '../recommend';
import { recipe } from './helpers';

const burrito = recipe('Chicken Burrito Bowl', ['chicken', 'rice', 'black beans', 'corn']);
const burritos = recipe('Beef Burritos', ['minced beef', 'tortilla wraps']);
const tacos = recipe('Crispy Fish Tacos', ['cod', 'cabbage']);
const quesadilla = recipe('Kip quesadilla', ['kipfilet', 'kaas', 'tortilla']);
const chipotle = recipe('Smoky chicken bowl', ['chicken', 'chipotle in adobo', 'rice']);
const carbonara = recipe('Spaghetti Carbonara', ['spaghetti', 'guanciale', 'egg']);
const wrap = recipe('Hummus veggie wrap', ['tortilla wrap', 'hummus', 'cucumber']);
const plainWrap = recipe('Chicken Caesar wrap', ['tortilla wrap', 'chicken', 'lettuce']);
const korean = recipe('Korean BBQ tacos', ['beef', 'gochujang', 'tortillas']);
const butterChicken = recipe('Butter Chicken', ['chicken', 'garam masala', 'cream']);
const nasi = recipe('Nasi goreng', ['rijst', 'ketjap', 'ei']);
const pho = recipe('Beef pho', ['rice noodles', 'beef']);
const photo = recipe('Photo-worthy pancakes', ['flour', 'egg', 'milk']);
const stamppot = recipe('Boerenkool stamppot', ['aardappelen', 'boerenkool', 'rookworst']);
const worstenbroodjes = recipe('Brabantse worstenbroodjes', ['bloem', 'gehakt']);

describe('cuisineLabel', () => {
  it('recognises Mexican dishes that never say "Mexican"', () => {
    for (const r of [burrito, burritos, tacos, quesadilla, chipotle]) {
      expect(cuisineLabel(r)).toBe('Mexican');
    }
  });

  it('recognises other cuisines from their dishes', () => {
    expect(cuisineLabel(carbonara)).toBe('Italian');
    expect(cuisineLabel(butterChicken)).toBe('Indian');
    expect(cuisineLabel(nasi)).toBe('Indonesian');
    expect(cuisineLabel(pho)).toBe('Vietnamese');
    expect(cuisineLabel(stamppot)).toBe('Dutch');
    expect(cuisineLabel(worstenbroodjes)).toBe('Dutch');
    expect(cuisineLabel(wrap)).toBe('Middle Eastern');
  });

  it('lets a cuisine named in the title win over a dish', () => {
    expect(cuisineLabel(korean)).toBe('Korean');
  });

  it('does not guess from generic ingredients or word fragments', () => {
    expect(cuisineLabel(plainWrap)).toBeNull();
    expect(cuisineLabel(photo)).toBeNull();
  });
});

describe('searching by cuisine', () => {
  const book = [burrito, burritos, tacos, quesadilla, carbonara, plainWrap, butterChicken];

  it('finds burritos and tacos for "mexico", "mexicaans" and "mexican"', () => {
    for (const q of ['mexico', 'mexicaans', 'Mexican', 'mexicaanse']) {
      const hits = book.filter(r => matchesQuery(r, q)).map(r => r.title);
      expect(hits).toEqual(['Chicken Burrito Bowl', 'Beef Burritos', 'Crispy Fish Tacos', 'Kip quesadilla']);
    }
  });

  it('combines a cuisine with an ingredient', () => {
    expect(book.filter(r => matchesQuery(r, 'mexicaans kip')).map(r => r.title))
      .toEqual(['Chicken Burrito Bowl', 'Kip quesadilla']);
  });

  it('finds Italian and Indian by their Dutch names', () => {
    expect(book.filter(r => matchesQuery(r, 'italiaans')).map(r => r.title)).toEqual(['Spaghetti Carbonara']);
    expect(book.filter(r => matchesQuery(r, 'indiaas')).map(r => r.title)).toEqual(['Butter Chicken']);
  });

  it('shows cuisine as a filter chip', () => {
    const chips = labelFacets(book).filter(f => f.kind === 'cuisine').map(f => f.value);
    expect(chips).toContain('Mexican');
  });

  it('puts Mexican recipes first when a large cookbook is pre-filtered for "iets mexicaans"', () => {
    const filler = Array.from({ length: 200 }, (_, i) => recipe(`Plain soup ${i}`, ['water']));
    const picked = prefilter([...filler, burrito, tacos], 'iets mexicaans');
    expect(picked.slice(0, 2).map(r => r.title).sort()).toEqual(['Chicken Burrito Bowl', 'Crispy Fish Tacos']);
  });
});
