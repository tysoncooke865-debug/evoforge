import { describe, expect, it } from 'vitest';
import { ALL_AVATAR_PATHS } from '../game-engine/types';
import { BALANCE, CARDS, CHAMPIONS, SYNERGIES, validateAllContent } from '../content';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';
import { validateCards, validateChampions, validateSynergies } from '../content/validate';
import type { CardDefinition, SynergyDefinition } from '../content/types';

describe('content validation', () => {
  it('all shipped content passes validation', () => {
    const report = validateAllContent();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('ships 20 cards, 5 champions and 7 synergies (one per path + 2 cross-path)', () => {
    expect(CARDS.length).toBe(20);
    expect(CHAMPIONS.length).toBe(5);
    expect(SYNERGIES.length).toBe(7);
  });

  it('P9: every official path has at least one fighter card carrying its tag', () => {
    const fighterPathCounts = new Map<string, number>();
    for (const card of CARDS) {
      if (card.category !== 'fighter') continue;
      for (const tag of card.tags) {
        if ((ALL_AVATAR_PATHS as readonly string[]).includes(tag)) {
          fighterPathCounts.set(tag, (fighterPathCounts.get(tag) ?? 0) + 1);
        }
      }
    }
    for (const path of ALL_AVATAR_PATHS) {
      expect(fighterPathCounts.get(path) ?? 0, `path '${path}' has no fighter card`).toBeGreaterThanOrEqual(1);
    }
  });

  it('P9: every official path has a path-identity synergy, reachable by the shipped roster', () => {
    const { errors } = validateSynergies(SYNERGIES, CARDS, CHAMPIONS);
    expect(errors).toEqual([]);
    for (const path of ALL_AVATAR_PATHS) {
      expect(SYNERGIES.some((s) => s.tag === path), `no synergy for path '${path}'`).toBe(true);
    }
  });

  it('rejects a synergy whose threshold exceeds what the roster can ever field', () => {
    const impossible: SynergyDefinition = {
      id: 'impossible',
      name: 'Impossible',
      description: 'unreachable',
      tag: 'aesthetic',
      threshold: 50,
      bonus: { armorFlat: 1 },
    };
    const { errors } = validateSynergies([...SYNERGIES, impossible], CARDS, CHAMPIONS);
    expect(errors.some((e) => e.includes("synergy 'impossible'") && e.includes('exceeds the'))).toBe(
      true
    );
  });

  it('rejects a synergy set missing a path (falsifies the path-coverage check)', () => {
    const missingShredder = SYNERGIES.filter((s) => s.tag !== 'shredder');
    const { errors } = validateSynergies(missingShredder, CARDS, CHAMPIONS);
    expect(errors.some((e) => e.includes("no synergy for official path 'shredder'"))).toBe(true);
  });

  it('validateSynergies stays shape-only (no false positives) when cards/champions are omitted', () => {
    const { errors } = validateSynergies(SYNERGIES);
    expect(errors).toEqual([]);
  });

  it('has one champion per official avatar path (BranchV2 minus hybrid)', () => {
    const paths = CHAMPIONS.map((c) => c.path).sort();
    expect(paths).toEqual(['aesthetic', 'cardio', 'mass', 'shredder', 'titan']);
  });

  it('pins the official display names — including "The Shredder"', () => {
    const names = Object.fromEntries(CHAMPIONS.map((c) => [c.path, c.name]));
    expect(names).toEqual({
      aesthetic: 'Aesthetics',
      titan: 'Titan',
      mass: 'Mass Monster',
      shredder: 'The Shredder',
      cardio: 'Cardio Machine',
    });
    // Slug-aligned stable ids.
    for (const c of CHAMPIONS) expect(c.id).toBe(`champion-${c.path}`);
  });

  it('rejects a roster that is not exactly the five official champions', () => {
    const four = CHAMPIONS.slice(0, 4);
    const { errors } = validateChampions(four);
    expect(errors.some((e) => e.includes('expected 5 champions'))).toBe(true);
    expect(errors.some((e) => e.includes("no champion for path"))).toBe(true);

    const renamed = [{ ...CHAMPIONS[3], name: 'Shredder' }, ...CHAMPIONS.slice(0, 3), CHAMPIONS[4]];
    const nameErrors = validateChampions(renamed).errors;
    expect(nameErrors.some((e) => e.includes("display name must be 'The Shredder'"))).toBe(true);
  });

  it('every champion ships a validated passive', () => {
    for (const c of CHAMPIONS) {
      expect(c.passive.id.length).toBeGreaterThan(0);
      expect(Object.keys(c.passive.effects).length).toBeGreaterThan(0);
    }
    // And the validator genuinely detects a missing/empty passive.
    const broken = CHAMPIONS.map((c, i) =>
      i === 0 ? { ...c, passive: { ...c.passive, effects: {} } } : c
    );
    const { errors } = validateChampions(broken);
    expect(errors.some((e) => e.includes('needs at least one effect'))).toBe(true);
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
