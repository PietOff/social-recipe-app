import { describe, expect, it } from 'vitest';
import { scaleSteps } from '../steps';

const ingredients = [
  { item: 'bloem', amount: '250', unit: 'g' },
  { item: 'zout', amount: '2', unit: 'tl' },
  { item: 'halfvolle melk', amount: '125', unit: 'ml' },
  { item: 'eieren', amount: '2' },
  { item: 'knoflook', amount: '1', unit: 'teentje' },
  { item: 'nootmuskaat', amount: '0.5', unit: 'tl' },
];

describe('scaleSteps', () => {
  it('scales amounts that belong to an ingredient', () => {
    const [step] = scaleSteps(['Doe 250 g bloem, 2 theelepel zout en 125 ml halfvolle melk in een kom.'], ingredients, 2, 'nl');
    expect(step).toBe('Doe 500 g bloem, 4 theelepel zout en 250 ml halfvolle melk in een kom.');
  });

  it('scales counted ingredients and follows singular/plural units', () => {
    expect(scaleSteps(['Klop 2 eieren los.'], ingredients, 1.5, 'nl')[0]).toBe('Klop 3 eieren los.');
    expect(scaleSteps(['Hak 1 teentje knoflook fijn.'], ingredients, 2, 'nl')[0]).toBe('Hak 2 teentjes knoflook fijn.');
    expect(scaleSteps(['Rasp ½ tl nootmuskaat erover.'], ingredients, 2, 'nl')[0]).toBe('Rasp 1 tl nootmuskaat erover.');
  });

  it('leaves temperatures, times and sizes alone', () => {
    const steps = [
      'Verwarm de oven voor op 200 °C.',
      'Kneed ongeveer 10 minuten tot een soepel deeg.',
      'Verdeel het deeg in 15 bolletjes van circa 30 g en laat 20 minuten rijzen.',
      'Bak 25 minuten op 180 graden.',
    ];
    expect(scaleSteps(steps, ingredients, 2, 'nl')).toEqual(steps);
  });

  it('does not touch a number that matches an amount but not the ingredient', () => {
    expect(scaleSteps(['Laat 2 tl olie heet worden.'], ingredients, 2, 'nl')[0]).toBe('Laat 2 tl olie heet worden.');
  });

  it('works in English and keeps the text unchanged at factor 1', () => {
    const en = [{ item: 'flour', amount: '250', unit: 'g' }, { item: 'garlic', amount: '2', unit: 'cloves' }];
    expect(scaleSteps(['Add 250 g flour and 2 cloves garlic.'], en, 0.5, 'en')[0]).toBe('Add 125 g flour and 1 clove garlic.');
    const steps = ['Add 250 g flour.'];
    expect(scaleSteps(steps, en, 1, 'en')).toBe(steps);
  });
});
