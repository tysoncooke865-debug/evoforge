import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DUEL_CONFIG,
  FORGE_CHIPS,
  MAX_TABLE_BODIES,
  chipBreakdown,
  chipPile,
  clampStake,
  decompose,
  countdown,
  describeEvent,
  estimateSupportReturn,
  eventTone,
  formatCoins,
  maxStakeFor,
  raiseLockCopy,
  supportSplit,
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

  it('stacks ONE denomination, the smallest that fits the budget', () => {
    expect(chipPile(50, 12)).toEqual(Array(10).fill(5));
    expect(chipPile(125, 12)).toEqual(Array(5).fill(25));
    expect(chipPile(2000, 12)).toEqual(Array(8).fill(250));
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

describe('supporter maths', () => {
  it('splits the meter and always totals 100', () => {
    const s = supportSplit(300, 200);
    expect(s).toEqual({ challengerPct: 60, opponentPct: 40, total: 500 });
    const odd = supportSplit(1, 2);
    expect(odd.challengerPct + odd.opponentPct).toBe(100);
  });

  it('shows an even bar when nobody has an opinion', () => {
    // Not 0/0, which reads as broken.
    expect(supportSplit(0, 0)).toEqual({ challengerPct: 50, opponentPct: 50, total: 0 });
  });

  it('pays a winner their stake plus a proportional share of the losing pool', () => {
    // Pools 300 vs 200; a 100-coin backer of the winner owns a third of the
    // winning pool and takes a third of the 200 that lost.
    expect(estimateSupportReturn(100, 300, 200)).toBe(166);
  });

  it('returns only the stake when nobody backed the other side', () => {
    expect(estimateSupportReturn(100, 300, 0)).toBe(100);
  });

  it('never pays out more than the two pools hold', () => {
    const mine = 40;
    const myPool = 40;
    const otherPool = 60;
    expect(estimateSupportReturn(mine, myPool, otherPool)).toBe(100);
    expect(estimateSupportReturn(mine, myPool, otherPool)).toBeLessThanOrEqual(myPool + otherPool);
  });

  it('honours a configured rake without ever going negative', () => {
    // 10% of the losing pool is burned; the rest is distributed.
    expect(estimateSupportReturn(100, 100, 200, 1000)).toBe(280);
    expect(estimateSupportReturn(0, 0, 200)).toBe(0);
  });
});

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
    expect(describeEvent(ev('raise_accepted', { pot: 400 }), names)).toBe('Raise accepted — pot 400');
    expect(describeEvent(ev('all_in_proposed', { amount: 782 }), names)).toContain('ALL IN — 782');
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
      'support_placed', 'support_closed', 'support_settled', 'settled',
    ];
    for (const k of kinds) {
      const line = describeEvent(ev(k, { amount: 10, pot: 20 }), names);
      expect(line).not.toContain('_');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('colours money, the lead and training differently', () => {
    expect(eventTone('raise_accepted')).toBe('money');
    expect(eventTone('support_placed')).toBe('money');
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
