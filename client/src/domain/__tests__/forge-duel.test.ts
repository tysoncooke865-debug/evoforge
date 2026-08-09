import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DUEL_CONFIG,
  FORGE_CHIPS,
  INGOT,
  ingotLabel,
  MAX_TABLE_BODIES,
  chipBreakdown,
  chipPile,
  clampStake,
  decompose,
  countdown,
  describeEvent,
  eventTone,
  formatCoins,
  maxStakeFor,
  raiseLockCopy,
  unitLabel,
  urgencyOf,
  type DuelEvent,
} from '../forge-duel';

/**
 * THE FORGE DUEL, client side.
 *
 * The SERVER owns every number that decides money (migrations 144–146,
 * falsified in SQL against production by tools/falsify-forge-duel.mjs). These
 * pin the PRESENTATION — and specifically the two places where a presentation
 * bug is indistinguishable from a theft:
 *
 *   1. A chip pile that does not add up to the number beside it.
 *   2. A MAX button that offers a stake the server would refuse.
 */

describe('chips', () => {
  it('breaks an amount down largest-first, and the pieces sum to it', () => {
    for (const amount of [5, 30, 125, 375, 500, 1285, 2000]) {
      const parts = chipBreakdown(amount);
      const total = parts.reduce((s, p) => s + p.value * p.count, 0);
      expect(total).toBe(amount);
    }
  });

  it('uses the fewest chips a person would reach for', () => {
    expect(chipBreakdown(125)).toEqual([
      { value: 100, count: 1 },
      { value: 25, count: 1 },
    ]);
    // Not twenty fives.
    expect(chipBreakdown(100)).toEqual([{ value: 100, count: 1 }]);
  });

  it('represents every denomination exactly', () => {
    for (const v of FORGE_CHIPS) {
      expect(chipBreakdown(v)).toEqual([{ value: v, count: 1 }]);
    }
  });

  it('leaves an unrepresentable remainder out rather than inventing a chip', () => {
    // 3 is below the smallest denomination; the pile shows nothing and the
    // NUMBER carries it. A chip that does not exist must never be drawn.
    expect(chipBreakdown(3)).toEqual([]);
    expect(chipBreakdown(7)).toEqual([{ value: 5, count: 1 }]);
  });

  /**
   * VALUE READS FROM THE METAL (v5.1 physics-pool brief).
   *
   * "Value-by-metal is the standard all-ages game-currency idiom and is permitted;
   * value-by-arbitrary-colour on discs is the casino convention and is not."
   *
   * The ladder used to map denominations onto RARITY tokens — 500 was 'mythic', so
   * a big chip glowed like a legendary drop. That is the escalating colour ladder a
   * casino uses, and it is what this pins shut.
   */
  it('every denomination is a real material, and none is a rarity tier', () => {
    const RARITY = ['common', 'rare', 'epic', 'legendary', 'mythic', 'accent', 'success'];
    expect(FORGE_CHIPS).toEqual([5, 10, 15, 25, 50, 100]);
    for (const v of FORGE_CHIPS) {
      const m = INGOT[v];
      expect(m, String(v)).toBeTruthy();
      expect(m.name, String(v)).toMatch(/^(Copper|Bronze|Iron|Steel|Sapphire|Ruby)$/);
      // A real colour, not a theme token that could be a rarity.
      expect(m.hex, m.name).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(RARITY, m.name).not.toContain(m.hex.toLowerCase());
      expect(ingotLabel(v)).toBe(`${m.name} ${v}`);
    }
    // Base metals climb, then the material changes KIND. The ladder has to be
    // ordered for the idiom to work, and the change of kind is what makes the top
    // of it legible from the silhouette alone.
    expect(FORGE_CHIPS.map((v) => INGOT[v].name))
      .toEqual(['Copper', 'Bronze', 'Iron', 'Steel', 'Sapphire', 'Ruby']);
    expect(FORGE_CHIPS.map((v) => INGOT[v].kind))
      .toEqual(['ingot', 'ingot', 'ingot', 'ingot', 'gem', 'gem']);
  });

  /** A gem must never appear BELOW a bar — the change of kind is the top of the
   *  ladder, and a sapphire worth less than a steel bar would read as noise. */
  it('gems sit above every metal', () => {
    const firstGem = FORGE_CHIPS.findIndex((v) => INGOT[v].kind === 'gem');
    expect(firstGem).toBeGreaterThan(0);
    expect(FORGE_CHIPS.slice(firstGem).every((v) => INGOT[v].kind === 'gem')).toBe(true);
  });

  /** The ceiling follows §4's 150 daily pledge cap. A denomination nobody can
   *  commit is decoration that implies the cap is higher than it is. */
  it('no denomination exceeds what a day may pledge', () => {
    expect(Math.max(...FORGE_CHIPS)).toBeLessThanOrEqual(150);
  });

  it('stacks ONE denomination, the smallest that fits the budget', () => {
    // v5.1 reladdered these to material tiers: 5/10/15/25/50/100. 15 is new and
    // 250/500 are gone, so 125 now fits in eight iron rather than five steel and
    // the top of the range is gold. The RULE is unchanged — smallest denomination
    // that fits the budget — and these are its answers on the new ladder.
    expect(chipPile(50, 12)).toEqual(Array(10).fill(5));      // copper
    expect(chipPile(125, 12)).toEqual(Array(8).fill(15));     // iron
    expect(chipPile(2000, 12)).toEqual(Array(12).fill(100));  // gold, pile capped
  });

  it('uses a BIGGER denomination for a bigger pot, always', () => {
    // This is the property the minimal breakdown broke: it drew 95 as five
    // chips and 100 as one, so a bigger pot rendered as a smaller pile. The
    // stack's height varies within a band; its COLOUR is what has to be
    // monotonic, and this pins it.
    let last = 0;
    for (let amount = 5; amount <= 5000; amount += 5) {
      const pile = chipPile(amount, 12);
      const unit = pile[0] ?? 0;
      expect(unit).toBeGreaterThanOrEqual(last);
      last = unit;
    }
  });

  it('never draws more than the budget, and never over-states the amount', () => {
    for (const amount of [5, 7, 60, 65, 95, 100, 500, 5000, 100_000]) {
      const pile = chipPile(amount, 12);
      expect(pile.length).toBeLessThanOrEqual(12);
      // The pile is texture; the number beside it is the truth. It may show
      // less than the pot holds, never more.
      expect(pile.reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(amount);
    }
  });

  it('draws nothing below the smallest denomination, and nothing for zero', () => {
    expect(chipPile(0)).toEqual([]);
    expect(chipPile(3)).toEqual([]);
    expect(chipPile(-10)).toEqual([]);
  });

  it('handles nonsense without throwing', () => {
    expect(chipBreakdown(-50)).toEqual([]);
    expect(chipBreakdown(0)).toEqual([]);
  });
});

describe('the physics table decomposition', () => {
  const sum = (chips: readonly number[]) => chips.reduce((s, v) => s + v, 0);

  it('is EXACT for every multiple of 5 a table can hold', () => {
    for (let amount = 5; amount <= 4000; amount += 5) {
      const chips = decompose(amount);
      if (chips.length < MAX_TABLE_BODIES) expect(sum(chips), `amount ${amount}`).toBe(amount);
    }
  });

  it('may under-state past the cap, and NEVER over-states', () => {
    for (const amount of [5, 137, 999, 5000, 50_000, 999_999]) {
      expect(sum(decompose(amount))).toBeLessThanOrEqual(amount);
    }
  });

  it('puts a real pile on the table instead of the fewest chips', () => {
    // The bug the browser caught: greedy largest-first made MAX two 500s, so
    // the biggest pot in the app rendered as two discs on an empty table.
    expect(decompose(1000).length).toBeGreaterThanOrEqual(7);
    expect(decompose(2000).length).toBeGreaterThanOrEqual(7);
    expect(decompose(50).length).toBeGreaterThanOrEqual(7);
  });

  it('spends the remainder downward so the total survives', () => {
    expect(sum(decompose(875))).toBe(875);
    expect(decompose(875).length).toBeLessThanOrEqual(20);
  });

  it('never exceeds the body cap, whatever it is handed', () => {
    for (const amount of [10_000, 250_000, 9_999_999]) {
      expect(decompose(amount).length).toBeLessThanOrEqual(MAX_TABLE_BODIES);
    }
  });

  it('does not invent a chip below the smallest denomination', () => {
    expect(decompose(0)).toEqual([]);
    expect(decompose(3)).toEqual([]);
    expect(decompose(-100)).toEqual([]);
    expect(decompose(5)).toEqual([5]);
  });

  it('handles an amount that is not a multiple of five without lying', () => {
    // 7 cannot be built from these denominations. The pile shows 5 and the
    // NUMBER beside it says 7 — under-stating is allowed, over-stating is not.
    expect(sum(decompose(7))).toBe(5);
  });
});

describe('the max button can never offer a refusal', () => {
  it('is bounded by the wallet', () => {
    expect(maxStakeFor(120, DEFAULT_DUEL_CONFIG)).toBe(120);
  });

  it('is bounded by the configured ceiling', () => {
    expect(maxStakeFor(99_999, DEFAULT_DUEL_CONFIG)).toBe(DEFAULT_DUEL_CONFIG.max_stake);
  });

  it('is bounded by the wallet percentage when one is set', () => {
    const cfg = { ...DEFAULT_DUEL_CONFIG, max_wallet_pct: 25 };
    expect(maxStakeFor(1000, cfg)).toBe(250);
  });

  it('is bounded by what the OPPONENT can cover', () => {
    // A stake they cannot match is an invite that can never be accepted.
    expect(maxStakeFor(1000, DEFAULT_DUEL_CONFIG, 300)).toBe(300);
  });

  it('clamps a proposed stake into the legal range', () => {
    expect(clampStake(9999, 400, DEFAULT_DUEL_CONFIG)).toBe(400);
    expect(clampStake(-5, 400, DEFAULT_DUEL_CONFIG)).toBe(0);
    // Below the minimum the answer is 0 (nothing staked), never a silent bump
    // up to a number the athlete did not choose.
    expect(clampStake(50, 3, DEFAULT_DUEL_CONFIG)).toBe(0);
  });
});

describe('the clock', () => {
  it('reads in the largest two units and never in seconds', () => {
    expect(countdown(2 * 86_400_000 + 14 * 3_600_000)).toBe('2D 14H');
    expect(countdown(5 * 3_600_000 + 42 * 60_000)).toBe('5H 42M');
    expect(countdown(12 * 60_000)).toBe('12M');
  });

  it('never shows 0M for a window that is still open', () => {
    expect(countdown(20_000)).toBe('1M');
  });

  it('says ENDED rather than a negative', () => {
    expect(countdown(0)).toBe('ENDED');
    expect(countdown(-5_000)).toBe('ENDED');
    expect(countdown(Number.NaN)).toBe('ENDED');
  });

  it('escalates urgency toward the deadline', () => {
    expect(urgencyOf(5 * 86_400_000)).toBe('calm');
    expect(urgencyOf(20 * 3_600_000)).toBe('soon');
    expect(urgencyOf(2 * 3_600_000)).toBe('final');
  });
});

/*
 * `describe('supporter maths')` USED TO LIVE HERE, and its deletion is the point.
 *
 * It tested a pari-mutuel book on a third party's duel: proportional shares of the
 * LOSING pool, and a configured rake that "burns 10% of the losing pool". Those
 * were correct tests of a mechanic v5 does not permit, and migration 164 dropped
 * the functions underneath them.
 *
 * A test asserting the payout curve of a retired bookmaker is not coverage, it is
 * a spec for rebuilding it. See V5_MIGRATION_AUDIT.md §4.
 */

describe('the raise lock explains itself', () => {
  const state = (over: Record<string, unknown>) =>
    ({ unlocked: false, reason: 'needs_session', ...over }) as never;

  it('names the athlete the duel is waiting on', () => {
    expect(raiseLockCopy(state({ waiting_on_name: 'Jesse' }), 'Tyson')).toContain('Jesse logs');
  });

  it('speaks in the second person when the reader is the blocker', () => {
    expect(raiseLockCopy(state({ waiting_on_name: 'Tyson' }), 'Tyson')).toContain('you log');
  });

  it('says when the duel has simply run out of raises', () => {
    expect(raiseLockCopy(state({ reason: 'max_raises', max_raises: 6 }), 'Tyson')).toContain('all 6');
  });

  it('says nothing at all once it is unlocked', () => {
    expect(raiseLockCopy({ unlocked: true, reason: 'ready' }, 'Tyson')).toBe('');
    expect(raiseLockCopy(null, 'Tyson')).toBe('');
  });
});

describe('the timeline reads as one line each', () => {
  const ev = (kind: string, detail: Record<string, unknown> = {}, actor = 'them'): DuelEvent => ({
    id: kind,
    kind: kind as DuelEvent['kind'],
    created_at: '2026-08-08T00:00:00Z',
    actor_id: actor,
    actor_name: 'Jesse',
    detail,
  });
  const names = { me: 'Tyson', myId: 'me' };

  it('says who did what, with the number that makes it actionable', () => {
    expect(describeEvent(ev('raise_proposed', { amount: 100 }), names)).toBe('Jesse proposed +100 each');
    expect(describeEvent(ev('raise_accepted', { pot: 400 }), names)).toBe('Raise accepted — pool 400');
    // v5 §10 bans "all in"; the sanctioned wording is MAX PLEDGE. The event KEY
    // stays `all_in_proposed` — the ban is on what a human reads, not on an
    // identifier, and renaming a live event key would be a data migration for a
    // copy rule.
    expect(describeEvent(ev('all_in_proposed', { amount: 782 }), names))
      .toContain('MAX PLEDGE — 782');
  });

  it('uses the second person for my own actions', () => {
    expect(describeEvent(ev('raise_proposed', { amount: 25 }, 'me'), names)).toBe('You proposed +25 each');
  });

  it('reports a lead change from the reader’s point of view', () => {
    expect(describeEvent(ev('lead_change', { leader_id: 'me' }), names)).toBe('You took the lead');
    expect(describeEvent(ev('lead_change', { leader_id: 'them' }), names)).toBe('Jesse took the lead');
    expect(describeEvent(ev('lead_change', { leader_id: null }), names)).toBe('Level — nothing between them');
  });

  it('compresses a whole session into one line', () => {
    expect(describeEvent(ev('workout_logged', { value: 5, unit: 'days' }), names))
      .toBe('Jesse logged a session — 5 days');
  });

  it('never renders a raw kind for a known event', () => {
    const kinds: DuelEvent['kind'][] = [
      'created', 'accepted', 'declined', 'cancelled', 'expired',
      'counter_stake_proposed', 'counter_stake_accepted', 'raise_declined',
      'raise_withdrawn', 'all_in_accepted', 'personal_record',
      'settled',
    ];
    for (const k of kinds) {
      const line = describeEvent(ev(k, { amount: 10, pot: 20 }), names);
      expect(line).not.toContain('_');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('colours money, the lead and training differently', () => {
    expect(eventTone('raise_accepted')).toBe('money');
    expect(eventTone('lead_change')).toBe('lead');
    expect(eventTone('workout_logged')).toBe('training');
    expect(eventTone('disputed')).toBe('quiet');
  });
});

describe('formatting', () => {
  it('groups four-figure balances so they can be read at a glance', () => {
    expect(formatCoins(1284)).toBe('1,284');
    expect(formatCoins(0)).toBe('0');
    expect(formatCoins(999)).toBe('999');
  });

  it('never renders "1 days"', () => {
    // The screenshot pass caught this on the scoreline, the lead strip AND the
    // result card at once — a scoreline that cannot count undermines every
    // other number on the page.
    expect(unitLabel(1, 'days')).toBe('1 day');
    expect(unitLabel(2, 'days')).toBe('2 days');
    expect(unitLabel(0, 'days')).toBe('0 days');
    expect(unitLabel(-1, 'days')).toBe('-1 day');
  });

  it('leaves abbreviations alone', () => {
    expect(unitLabel(30, 'min')).toBe('30 min');
    expect(unitLabel(1, 'min')).toBe('1 min');
    expect(unitLabel(82.5, 'kg')).toBe('82.5 kg');
  });
});
