import { describe, expect, it } from 'vitest';
import { formatClock, stepIngredients, stepTimers } from '../cooking';

describe('stepTimers', () => {
  it('finds durations in both languages', () => {
    expect(stepTimers('Kneed ongeveer 10 minuten tot een soepel deeg.')).toEqual([{ label: '10 minuten', seconds: 600 }]);
    expect(stepTimers('Bake for 25 mins until golden.')).toEqual([{ label: '25 mins', seconds: 1500 }]);
    expect(stepTimers('Laat 1 uur rijzen.')[0].seconds).toBe(3600);
    expect(stepTimers('Simmer for 1,5 hours.')[0].seconds).toBe(5400);
  });

  it('takes the long end of a range and adds up hours and minutes', () => {
    expect(stepTimers('Bak 10-12 minuten.')[0]).toEqual({ label: '10-12 minuten', seconds: 720 });
    expect(stepTimers('Stoof 1 uur en 15 minuten.')).toEqual([{ label: '1 uur en 15 minuten', seconds: 4500 }]);
  });

  it('finds several timers and ignores temperatures and amounts', () => {
    const t = stepTimers('Verwarm de oven op 200 °C. Bak 20 minuten, draai om en bak nog 5 minuten. Voeg 250 g bloem toe.');
    expect(t.map(x => x.seconds)).toEqual([1200, 300]);
  });

  it('does not read words as units', () => {
    expect(stepTimers('Gebruik 2 middelgrote uien en 3 sjalotten.')).toEqual([]);
  });
});

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('stepIngredients', () => {
  const ingredients = [
    { item: 'bloem', amount: '250', unit: 'g' },
    { item: 'halfvolle melk', amount: '125', unit: 'ml' },
    { item: 'eieren', amount: '2' },
    { item: 'zout', amount: '1', unit: 'tl' },
  ];
  it('lists the ingredients a step names', () => {
    expect(stepIngredients('Meng de bloem met de melk.', ingredients).map(i => i.item)).toEqual(['bloem', 'halfvolle melk']);
    expect(stepIngredients('Klop de eieren los met wat zout.', ingredients).map(i => i.item)).toEqual(['eieren', 'zout']);
    expect(stepIngredients('Verwarm de oven voor.', ingredients)).toEqual([]);
  });
});
