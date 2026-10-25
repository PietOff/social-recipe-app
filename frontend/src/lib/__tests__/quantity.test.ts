import { describe, expect, it } from 'vitest';
import { displayQuantity, localUnit, prettyAmount } from '../quantity';
import { aggregate, addEntry, EMPTY_LIST } from '../shopping';

describe('displayQuantity', () => {
  it('shows small ml amounts as spoons', () => {
    expect(displayQuantity({ amount: '10', unit: 'ml', item: 'zout' }, 'nl')).toBe('2 tl');
    expect(displayQuantity({ amount: '2.5', unit: 'ml' }, 'nl')).toBe('½ tl');
    expect(displayQuantity({ amount: '5', unit: 'ml' }, 'en')).toBe('1 tsp');
    expect(displayQuantity({ amount: '7,5', unit: 'ml' }, 'nl')).toBe('1½ tl');
    expect(displayQuantity({ amount: '15', unit: 'ml' }, 'nl')).toBe('1 el');
    expect(displayQuantity({ amount: '45', unit: 'ml' }, 'nl')).toBe('3 el');
    expect(displayQuantity({ amount: '20', unit: 'ml' }, 'nl')).toBe('20 ml');
    expect(displayQuantity({ amount: '125', unit: 'ml' }, 'nl')).toBe('125 ml');
  });

  it('reads a bare "1" for salt or pepper as to taste, but not for a chili', () => {
    expect(displayQuantity({ amount: '1', unit: '', item: 'zout' }, 'nl')).toBe('naar smaak');
    expect(displayQuantity({ amount: '1', unit: '', item: 'Peper' }, 'nl')).toBe('naar smaak');
    expect(displayQuantity({ amount: '1', unit: '', item: 'zwarte peper' }, 'nl')).toBe('naar smaak');
    expect(displayQuantity({ amount: '1', unit: '', item: 'freshly ground black pepper' }, 'en')).toBe('to taste');
    expect(displayQuantity({ amount: '1', unit: '', item: 'zout en peper' }, 'nl')).toBe('naar smaak');
    expect(displayQuantity({ amount: '1', unit: '', item: 'rode peper' }, 'nl')).toBe('1');
    expect(displayQuantity({ amount: '1', unit: 'tl', item: 'zout' }, 'nl')).toBe('1 tl');
    expect(displayQuantity({ amount: '2', unit: '', item: 'zout' }, 'nl')).toBe('2');
  });

  it('writes small decimals and slash fractions as fractions', () => {
    expect(displayQuantity({ amount: '0.5', unit: 'teaspoon' }, 'nl')).toBe('½ tl');
    expect(displayQuantity({ amount: '1.5', unit: 'tbsp' }, 'en')).toBe('1½ tbsp');
    expect(displayQuantity({ amount: '1/4', unit: 'tsp' }, 'en')).toBe('¼ tsp');
    expect(displayQuantity({ amount: '0,25', unit: 'tl' }, 'nl')).toBe('¼ tl');
    expect(displayQuantity({ amount: '1.0', unit: '' }, 'en')).toBe('1');
  });

  it('leaves large amounts, ranges and text alone', () => {
    expect(displayQuantity({ amount: '250', unit: 'g' }, 'nl')).toBe('250 g');
    expect(displayQuantity({ amount: '12.5', unit: 'g' }, 'nl')).toBe('12.5 g');
    expect(displayQuantity({ amount: '2-3', unit: 'cloves' }, 'nl')).toBe('2-3 teentjes');
    expect(displayQuantity({ amount: '400g', unit: 'g' }, 'en')).toBe('400g');
  });

  it('uses the units of the reader\'s language, singular or plural', () => {
    expect(displayQuantity({ amount: '2', unit: 'tablespoons' }, 'nl')).toBe('2 el');
    expect(displayQuantity({ amount: '2', unit: 'eetlepels' }, 'en')).toBe('2 tbsp');
    expect(displayQuantity({ amount: '1', unit: 'cloves' }, 'nl')).toBe('1 teentje');
    expect(displayQuantity({ amount: '4', unit: 'teentje' }, 'en')).toBe('4 cloves');
    expect(displayQuantity({ amount: '1', unit: 'blik' }, 'en')).toBe('1 can');
    expect(displayQuantity({ amount: '1', unit: 'cup' }, 'nl')).toBe('1 cup');
  });

  it('drops count-only units', () => {
    expect(displayQuantity({ amount: '1', unit: 'piece' }, 'en')).toBe('1');
    expect(displayQuantity({ amount: '1', unit: 'stuk' }, 'nl')).toBe('1');
  });

  it('says "to taste" for empty amounts and translates vague ones', () => {
    expect(displayQuantity({}, 'nl')).toBe('naar smaak');
    expect(displayQuantity({ amount: '', unit: 'piece' }, 'en')).toBe('to taste');
    expect(displayQuantity({ amount: 'naar smaak' }, 'en')).toBe('to taste');
    expect(displayQuantity({ amount: 'a pinch' }, 'nl')).toBe('een snufje');
    expect(displayQuantity({ unit: 'snufje' }, 'en')).toBe('a pinch');
    expect(displayQuantity({ amount: 'to taste' }, 'nl')).toBe('naar smaak');
  });

  it('helpers behave on their own', () => {
    expect(prettyAmount('0.75', 'en')).toBe('¾');
    expect(prettyAmount('', 'en')).toBe('');
    expect(localUnit('Tbsp', '1', 'nl')).toBe('el');
    expect(localUnit('pinch', '3', 'en')).toBe('pinches');
  });
});

describe('shopping list across languages', () => {
  it('adds up the same unit written in two languages', () => {
    const a = { key: 'a', title: 'A', factor: 1, ingredients: [{ item: 'knoflook', amount: '1', unit: 'clove' }] };
    const b = { key: 'b', title: 'B', factor: 1, ingredients: [{ item: 'Knoflook', amount: '2', unit: 'teentjes' }] };
    const items = aggregate(addEntry(addEntry(EMPTY_LIST, a), b), 'nl');
    expect(items.find(i => i.key === 'knoflook')?.amounts).toEqual(['3 teentjes']);
  });
});
