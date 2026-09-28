import { describe, expect, it } from 'vitest';
import { addEntry, aggregate, EMPTY_LIST, removeEntry, toggleChecked, toText } from '../shopping';

const curry = {
  key: 'curry', title: 'Curry', factor: 1,
  ingredients: [
    { item: 'Onion', amount: '1' },
    { item: 'Rice', amount: '200', unit: 'g' },
    { item: 'Salt', amount: 'to taste' },
  ],
};
const stew = {
  key: 'stew', title: 'Stew', factor: 2,
  ingredients: [
    { item: 'onion', amount: '2' },
    { item: 'rice', amount: '100g', unit: 'g' },
    { item: 'Rice', amount: '1', unit: 'cup' },
  ],
};

describe('aggregate', () => {
  it('merges the same ingredient across recipes and adds up equal units', () => {
    const items = aggregate(addEntry(addEntry(EMPTY_LIST, curry), stew));
    const onion = items.find(i => i.key === 'onion');
    const rice = items.find(i => i.key === 'rice');
    expect(onion?.amounts).toEqual(['5']); // 1 + 2 x 2
    expect(rice?.amounts).toEqual(['400 g', '2 cup']); // 200 + 100 x 2, and cups kept apart
    expect(rice?.recipes).toEqual(['Curry', 'Stew']);
    expect(items.find(i => i.key === 'salt')?.amounts).toEqual(['to taste']);
  });

  it('keeps one entry per recipe', () => {
    const list = addEntry(addEntry(EMPTY_LIST, curry), { ...curry, factor: 3 });
    expect(list.entries).toHaveLength(1);
    expect(aggregate(list).find(i => i.key === 'onion')?.amounts).toEqual(['3']);
    expect(removeEntry(list, 'curry').entries).toHaveLength(0);
  });
});

describe('fractions', () => {
  it('adds up unicode and slash fractions instead of reading them as a unit', () => {
    const a = { key: 'a', title: 'A', factor: 1, ingredients: [{ item: 'ui', amount: '1½' }, { item: 'zout', amount: '1/2', unit: 'tl' }] };
    const b = { key: 'b', title: 'B', factor: 1, ingredients: [{ item: 'Ui', amount: '1 1/2' }, { item: 'zout', amount: '¼', unit: 'tl' }] };
    const items = aggregate(addEntry(addEntry(EMPTY_LIST, a), b), 'nl');
    expect(items.find(i => i.key === 'ui')?.amounts).toEqual(['3']);
    expect(items.find(i => i.key === 'zout')?.amounts).toEqual(['¾ tl']);
  });
});

describe('checking off and exporting', () => {
  it('toggles items and marks them in the text', () => {
    let list = addEntry(EMPTY_LIST, curry);
    list = toggleChecked(list, 'onion');
    expect(list.checked).toEqual(['onion']);
    const text = toText(aggregate(list), list.checked);
    expect(text).toContain('☑ 1 Onion');
    expect(text).toContain('☐ 200 g Rice');
    expect(toggleChecked(list, 'onion').checked).toEqual([]);
  });
});
