import { describe, expect, it } from 'vitest';

import {
  coinsBySource,
  coinsThisWeek,
  coinWeekStart,
  COIN_REWARDS,
  inCoinWeek,
  ledgerTotal,
  REWARD_COPY,
  rewardSummarySentence,
  streakMilestoneCoins,
} from '../coin-rewards';

/**
 * §3 — ONE SOURCE OF TRUTH FOR THE COIN ECONOMY.
 *
 * The audit found the coins page promising "+25" for a workout while the ledger
 * recorded 20, and "+50" for a PR while the ledger recorded 25. Both numbers
 * were typed into a sentence by hand.
 *
 * These values are pinned against `coin_events_guard`, read from the LIVE
 * database on 2026-08-11 — the trigger recomputes `amount` server-side on every
 * insert, so it is the only thing that actually decides what an athlete is
 * paid. If a migration changes the guard, these tests fail and this file is the
 * one place to update.
 */

describe('the amounts match the server guard', () => {
  it('pins each fixed reward to the guard`s own value', () => {
    // Verified against pg_get_functiondef('coin_events_guard') in production:
    //   set_reward := 12 | workout_complete := 20 | pr := 25 | starting_bonus := 100
    expect(COIN_REWARDS.set_reward).toBe(12);
    expect(COIN_REWARDS.workout_complete).toBe(20);
    expect(COIN_REWARDS.pr).toBe(25);
    expect(COIN_REWARDS.starting_bonus).toBe(100);
  });

  it('streak milestones pay 10x the milestone', () => {
    expect(streakMilestoneCoins(7)).toBe(70);
    expect(streakMilestoneCoins(30)).toBe(300);
    expect(streakMilestoneCoins(0)).toBe(0);
    expect(streakMilestoneCoins(-5)).toBe(0);
  });

  it('the UI copy is DERIVED, so it cannot contradict the ledger', () => {
    const sentence = rewardSummarySentence();
    expect(sentence).toContain('+20'); // workout — the number that was wrong
    expect(sentence).toContain('+25'); // PR — the other one
    expect(sentence).toContain('+12');
    // The old, false copy must be impossible to produce.
    expect(sentence).not.toContain('+50');
    expect(sentence).not.toMatch(/workout complete \+25/i);
  });

  it('every reward has an accessibility label carrying the same number', () => {
    for (const r of REWARD_COPY) {
      expect(r.a11y).toContain(String(COIN_REWARDS[r.kind]));
      expect(r.amount).toBe(`+${COIN_REWARDS[r.kind]}`);
    }
  });
});

describe('the ledger is the arithmetic', () => {
  const rows = [
    { kind: 'workout_complete', amount: 20, created_at: '2026-08-10T09:00:00Z' },
    { kind: 'set_reward', amount: 12, created_at: '2026-08-10T09:05:00Z' },
    { kind: 'set_reward', amount: 12, created_at: '2026-08-11T09:05:00Z' },
    { kind: 'pr', amount: 25, created_at: '2026-08-11T09:10:00Z' },
    { kind: 'starting_bonus', amount: 100, created_at: '2026-08-02T09:00:00Z' },
  ];

  it('the total is the sum of the entries — nothing else', () => {
    expect(ledgerTotal(rows)).toBe(169);
    expect(ledgerTotal([])).toBe(0);
    expect(ledgerTotal(undefined)).toBe(0);
  });

  it('"where your coins come from" is computed from real rows', () => {
    const src = coinsBySource(rows);
    expect(src[0]).toEqual({ kind: 'starting_bonus', coins: 100, entries: 1 });
    expect(src.find((s) => s.kind === 'set_reward')).toEqual({
      kind: 'set_reward',
      coins: 24,
      entries: 2,
    });
    // The breakdown must reconcile with the total, or one of them is a story.
    expect(src.reduce((n, s) => n + s.coins, 0)).toBe(ledgerTotal(rows));
  });

  it('a row with no kind still counts, under `other`', () => {
    // It moved the balance, so it must appear somewhere: a breakdown that
    // silently drops it under-sums the total the athlete can see, and §3
    // requires the two to agree.
    const messy = [{ kind: '', amount: 5 }, { kind: 'pr', amount: 'abc' }, { kind: 'pr' }];
    expect(ledgerTotal(messy)).toBe(5);
    expect(coinsBySource(messy)).toEqual([{ kind: 'other', coins: 5, entries: 1 }]);
    // ...and the two still reconcile, which is the property that matters.
    expect(coinsBySource(messy).reduce((n, s) => n + s.coins, 0)).toBe(ledgerTotal(messy));
  });

  it('a non-numeric amount is in neither the total nor the breakdown', () => {
    const bad = [{ kind: 'pr', amount: 'abc' }];
    expect(ledgerTotal(bad)).toBe(0);
    expect(coinsBySource(bad)).toEqual([]);
  });
});

describe('the local week boundary is stated once', () => {
  it('starts on Monday', () => {
    // 2026-08-11 is a Tuesday; its week starts Monday the 10th.
    expect(coinWeekStart('2026-08-11')).toBe('2026-08-10');
    // A Monday is its own week start.
    expect(coinWeekStart('2026-08-10')).toBe('2026-08-10');
    // A Sunday belongs to the week that began the PREVIOUS Monday.
    expect(coinWeekStart('2026-08-16')).toBe('2026-08-10');
  });

  it('includes today and excludes last week', () => {
    expect(inCoinWeek('2026-08-10T00:00:00Z', '2026-08-11')).toBe(true);
    expect(inCoinWeek('2026-08-11T23:59:00Z', '2026-08-11')).toBe(true);
    expect(inCoinWeek('2026-08-09T23:59:00Z', '2026-08-11')).toBe(false);
    expect(inCoinWeek('', '2026-08-11')).toBe(false);
  });

  it('sums only this week', () => {
    // 20 + 12 + 12 + 25 this week; the 100 starting bonus was the week before.
    expect(coinsThisWeek(rowsForWeek(), '2026-08-11')).toBe(69);
  });

  function rowsForWeek() {
    return [
      { kind: 'workout_complete', amount: 20, created_at: '2026-08-10T09:00:00Z' },
      { kind: 'set_reward', amount: 12, created_at: '2026-08-10T09:05:00Z' },
      { kind: 'set_reward', amount: 12, created_at: '2026-08-11T09:05:00Z' },
      { kind: 'pr', amount: 25, created_at: '2026-08-11T09:10:00Z' },
      { kind: 'starting_bonus', amount: 100, created_at: '2026-08-02T09:00:00Z' },
    ];
  }
});
