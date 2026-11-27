import { describe, expect, it } from 'vitest';
import type { SeasonsCardCost } from '@bgx/protocol/games/seasons';
import { SEASONS_CARDS } from './cards/base.js';
import { resolveCost } from './rules/play.js';

// Source: local sixth-revision bilingual workbook, sheet "全卡卡表", E:J.
// Rows 50:99 = base; 29:48 = expansion 1; 8:27 = expansion 2.
// The workbook, not image colors or BGA material data, owns these values.
// W/A/F/E are water/air/fire/earth; C is crystals; "/" separates 2/3/4 players.
const WORKBOOK_COSTS = [
  'AA', 'FF', 'EE', 'WW', 'C2', 'EEE', '', 'AF', 'WAFE', 'FFF',
  'C3/C6/C9', 'C3', 'WF', 'AE', '', 'AAA', 'WA', 'WE', 'AAA', 'AFEC3',
  'AF', 'C20', 'FF', 'AA', 'WW', 'EE', 'WAFE', 'WAFE', 'WWW', 'WFE',
  '', 'EE', 'C2/C5/C8', 'FE', '', 'WA', 'WFE', 'WAFE', 'F/FF/FFF', 'AAA',
  'C0/C3/C6', 'W', 'WAFE', 'WAA', 'FFFEEE', 'WWE', 'C3', 'WAF', 'E/EE/EEE', 'W',
  'EE', 'WE', 'EE', 'WA', 'FF', 'WWWAAA', 'WFE', 'AF', 'WE', 'WFF',
  'FE', 'FF', 'A', 'AE', 'WW', '', 'AE', 'F', 'A', 'C2/C4/C6',
  '', 'F/FF/FFF', '', 'WAFE', 'EE', 'WFE', 'WAFE', 'WW', 'FF', 'W',
  'A', 'WEC2/WEC1/WE', 'WAE', 'AFE', 'C2', 'AF', 'AE', 'A', 'WA', 'F',
] as const;

const WORKBOOK_POINTS = [
  6, 6, 6, 6, 4, 9, 8, 6, 10, 14, 7, 8, 4, 8, 8, 9, 8, 8, 10, 9,
  6, 30, 0, 0, 0, 0, 6, 8, 0, 6, 2, 12, 8, 6, 0, 0, 9, 16, 4, 12,
  6, -10, 0, 6, 24, 10, 8, 0, 6, -5,
  7, 4, 6, 6, 7, 24, 6, 7, 6, 10, 0, 10, 5, 10, 9, 8, 4, 2, 6, 8,
  8, 0, null, 0, 7, 12, 10, 6, 8, 7, 8, 12, 10, 12, 10, 10, 14, -5, 10, 4,
] as const;

function workbookCost(code: string): SeasonsCardCost {
  const cost = { water: 0, air: 0, fire: 0, earth: 0, crystal: 0 };
  const names = { W: 'water', A: 'air', F: 'fire', E: 'earth' } as const;
  for (const symbol of code.replace(/C\d+/, '')) {
    cost[names[symbol as keyof typeof names]] += 1;
  }
  cost.crystal = Number(code.match(/C(\d+)/)?.[1] ?? 0);
  return cost;
}

describe('sixth-revision bilingual workbook card values', () => {
  it('covers all 90 distinct identities and printed points', () => {
    expect(WORKBOOK_COSTS).toHaveLength(90);
    expect(WORKBOOK_POINTS).toHaveLength(90);
    expect(SEASONS_CARDS.map((card) => card.id)).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    SEASONS_CARDS.forEach((card, index) => {
      // Twist of Fate has "/" rather than a printed score in the workbook.
      if (WORKBOOK_POINTS[index] !== null) expect(card.points).toBe(WORKBOOK_POINTS[index]);
    });
  });
  WORKBOOK_COSTS.forEach((code, index) => {
    for (const count of [2, 3, 4]) {
      it(`#${index + 1} costs the workbook amount for ${count} players`, () => {
        const def = SEASONS_CARDS.find((card) => card.id === index + 1)!;
        const choices = code.split('/');
        expect(resolveCost(def, count)).toEqual(workbookCost(choices[count - 2] ?? choices[0]!));
        if (index === 30) {
          expect(def.costFlexible).toEqual({ min: 1, max: 4, maxPerType: 1 });
        }
      });
    }
  });
});
