import { describe, expect, it } from 'vitest';
import { labelFacets, labelValues, parseMinutes } from '../labels';
import { recipe } from './helpers';

describe('derived labels', () => {
  it('does not call minced garlic beef', () => {
    const labels = labelValues(recipe('Garlic pasta', ['pasta', 'minced garlic']));
    expect(labels).not.toContain('Beef');
    expect(labels).toContain('Vegetarian');
  });

  it('does not read "raw" inside "strawberry"', () => {
    const labels = labelValues(recipe('Strawberry tart', ['strawberries'], { instructions: ['Bake for 20 min.'] }));
    expect(labels).not.toContain('No cook');
  });

  it('does not call meatballs vegetarian', () => {
    expect(labelValues(recipe('Swedish meatballs', ['meatballs', 'cream']))).not.toContain('Vegetarian');
  });

  it('merges the One-Pan tag with the derived One pan label', () => {
    const labels = labelValues(recipe('Tray bake', ['potatoes'], {
      tags: ['One-Pan'],
      instructions: ['Cook everything in one pan.'],
    }));
    expect(labels.filter(l => l.toLowerCase().replace('-', ' ') === 'one pan')).toHaveLength(1);
  });

  describe('Dutch recipes', () => {
    it('treats "gehakte ui" as chopped onion, not meat', () => {
      const labels = labelValues(recipe('Linzensoep', ['linzen', 'gehakte ui', 'peterselie, fijn gehakt']));
      expect(labels).not.toContain('Beef');
      expect(labels).toContain('Vegetarian');
    });

    it('treats "gehakt" as an ingredient as minced meat', () => {
      expect(labelValues(recipe('Pastasaus', ['gehakt', 'tomaten']))).toContain('Beef');
      expect(labelValues(recipe('Lasagne', ['half-om-half gehakt']))).toContain('Beef');
    });

    it('does not read "vlees" inside "vleestomaat"', () => {
      expect(labelValues(recipe('Gevulde tomaten', ['vleestomaten', 'rijst']))).toContain('Vegetarian');
    });

    it('recognises Dutch meat words', () => {
      expect(labelValues(recipe('Kip tandoori', ['kipfilet']))).toContain('Chicken');
      expect(labelValues(recipe('Stoof', ['runderlappen']))).toContain('Beef');
    });
  });
});

describe('parseMinutes', () => {
  it('reads English, Dutch and ISO durations', () => {
    expect(parseMinutes('1 hr 10 min')).toBe(70);
    expect(parseMinutes('1 uur 10 minuten')).toBe(70);
    expect(parseMinutes('45 minuten')).toBe(45);
    expect(parseMinutes('PT25M')).toBe(25);
    expect(parseMinutes('20')).toBe(20);
    expect(parseMinutes('')).toBeNull();
  });
});

describe('labelFacets', () => {
  it('counts each label once per recipe, most common first', () => {
    const recipes = [
      recipe('A', ['chicken'], { tags: ['Dinner'] }),
      recipe('B', ['chicken'], { tags: ['Dinner'] }),
      recipe('C', ['rice'], { tags: ['Lunch'] }),
    ];
    const facets = labelFacets(recipes);
    expect(facets[0].count).toBeGreaterThanOrEqual(facets[facets.length - 1].count);
    expect(facets.find(f => f.value === 'Dinner')?.count).toBe(2);
    expect(facets.find(f => f.value === 'Chicken')?.count).toBe(2);
  });
});
