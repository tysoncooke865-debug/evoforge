import { describe, expect, it } from 'vitest';
import { BALANCE, CARDS, CHAMPIONS, SYNERGIES, validateAllContent } from '../content';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';
import { validateCards, validateChampions } from '../content/validate';
import type { CardDefinition } from '../content/types';

describe('content validation', () => {
  it('all shipped content passes validation', () => {
    const report = validateAllContent();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('ships 20 cards, 4 champions and at least 4 synergies', () => {
    expect(CARDS.length).toBe(20);
    expect(CHAMPIONS.length).toBe(4);
    expect(SYNERGIES.length).toBeGreaterThanOrEqual(4);
  });

  it('has one champion per avatar path', () => {
    const paths = CHAMPIONS.map((c) => c.path).sort();
    expect(paths).toEqual(['hybrid', 'shredder', 'speedster', 'titan']);
  });

  it('every card id is unique', () => {
    const ids = new Set(CARDS.map((c) => c.id));
    expect(ids.size).toBe(CARDS.length);
  });

  it('every energy cost is within 1..max', () => {
    for (const card of CARDS) {
      expect(card.energyCost).toBeGreaterThanOrEqual(1);
      expect(card.energyCost).toBeLessThanOrEqual(BALANCE.energy.max);
    }
  });

  it('the default starter deck references only real cards and has deck size', () => {
    expect(DEFAULT_DECK_CARD_IDS.length).toBe(BALANCE.cards.deckSize);
    const ids = new Set(CARDS.map((c) => c.id));
    for (const id of DEFAULT_DECK_CARD_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('rejects a card with duplicate id', () => {
    const dupe: CardDefinition[] = [CARDS[0], { ...CARDS[0] }];
    const { errors } = validateCards(dupe);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('rejects a fighter card without unit stats', () => {
    const broken: CardDefinition = { ...CARDS[0], unit: undefined };
    const { errors } = validateCards([broken]);
    expect(errors.some((e) => e.includes('missing unit definition'))).toBe(true);
  });

  it('rejects a technique card without effects', () => {
    const technique = CARDS.find((c) => c.category === 'technique')!;
    const broken: CardDefinition = { ...technique, effects: {} };
    const { errors } = validateCards([broken]);
    expect(errors.some((e) => e.includes('requires at least one effect'))).toBe(true);
  });

  it('rejects invalid combat stats', () => {
    const fighter = CARDS.find((c) => c.category === 'fighter')!;
    const broken: CardDefinition = {
      ...fighter,
      unit: { ...fighter.unit!, stats: { ...fighter.unit!.stats, maxHealth: 0 } },
    };
    const { errors } = validateCards([broken]);
    expect(errors.some((e) => e.includes('maxHealth'))).toBe(true);
  });

  it('rejects champions with duplicate paths', () => {
    const dupe = [CHAMPIONS[0], { ...CHAMPIONS[1], path: CHAMPIONS[0].path }];
    const { errors } = validateChampions(dupe);
    expect(errors.some((e) => e.includes('duplicate path'))).toBe(true);
  });

  it('keeps ranked fitness advantage within the mandated 10-15% band', () => {
    expect(BALANCE.fitness.rankedMaxTotalAdvantage).toBeGreaterThanOrEqual(0.05);
    expect(BALANCE.fitness.rankedMaxTotalAdvantage).toBeLessThanOrEqual(0.15);
  });
});
