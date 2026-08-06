import { describe, expect, it } from 'vitest';

import {
  COIN_SET_FLOOR,
  COINS_PER_PR,
  COINS_PER_WORKOUT,
  classifyClaimError,
  sessionCoins,
} from '../coin-claims';

/** The 013/033/061 guard's literal raise strings (and Postgres's own
 *  unique-violation wording) — the classification must keep absorbing
 *  exactly what the old boolean regex absorbed, but with names. */
describe('classifyClaimError', () => {
  it('a unique-index violation is a DUPLICATE (already earned, silent)', () => {
    expect(
      classifyClaimError('duplicate key value violates unique constraint "coin_events_once"')
    ).toEqual({ outcome: 'duplicate' });
  });

  it('the ≥10-set floor is the NAMEABLE rejection the toast cares about', () => {
    expect(classifyClaimError('coin_events: not enough training on 2026-07-21 (4 sets).')).toEqual({
      outcome: 'rejected',
      reason: 'not_enough_training',
    });
  });

  it('a non-PR claim is rejected quietly', () => {
    expect(classifyClaimError('coin_events: that set is not a PR.')).toEqual({
      outcome: 'rejected',
      reason: 'not_a_pr',
    });
  });

  it('an unproven streak milestone is rejected quietly', () => {
    expect(classifyClaimError('coin_events: streak milestone 7 not proven by the log.')).toEqual({
      outcome: 'rejected',
      reason: 'milestone_not_proven',
    });
  });

  it('any other check_violation falls into the generic guard bucket (still silent)', () => {
    expect(classifyClaimError('new row violates check constraint "coin_events_amount_sane"')).toEqual(
      { outcome: 'rejected', reason: 'guard' }
    );
  });

  it('an unnamed guard refusal (still the trigger\'s own voice) stays silent, not an error', () => {
    // e.g. a queued PR claim racing its own not-yet-synced workout_log row.
    expect(classifyClaimError('coin_events: no matching owned set (abc-123).')).toEqual({
      outcome: 'rejected',
      reason: 'guard',
    });
  });

  it('an unexpected error keeps its message and is the ONLY toast-as-error case', () => {
    expect(classifyClaimError('Failed to fetch')).toEqual({
      outcome: 'error',
      message: 'Failed to fetch',
    });
  });

  it('ORDER MATTERS: a duplicate mentioning "check" in passing is still a duplicate', () => {
    expect(
      classifyClaimError('duplicate key — check the unique index coin_events_once')
    ).toEqual({ outcome: 'duplicate' });
  });
});

/**
 * WHAT THE COMPLETION SCREEN MAY CLAIM ABOUT COINS (2026-08-06). The brief
 * wants coins on the completion screen and bans fabricated progression, so
 * this mirrors the 013 guard's two rules exactly: the 10-set daily floor, and
 * workout_complete banking once per DATE.
 */
describe('sessionCoins', () => {
  const base = { date: '2026-08-06', setsToday: 12, prCount: 0, events: [] as { kind: string; source_id?: string | null }[] };

  it('a qualifying first workout banks the workout coins', () => {
    expect(sessionCoins(base)).toEqual({ amount: COINS_PER_WORKOUT, blocked: null });
  });

  it('under the floor it banks nothing, and says which rule stopped it', () => {
    expect(sessionCoins({ ...base, setsToday: 6 })).toEqual({ amount: 0, blocked: 'floor' });
  });

  it('the floor is 10 counted sets, inclusive', () => {
    expect(sessionCoins({ ...base, setsToday: COIN_SET_FLOOR })!.amount).toBe(COINS_PER_WORKOUT);
    expect(sessionCoins({ ...base, setsToday: COIN_SET_FLOOR - 1 })!.amount).toBe(0);
  });

  it('the SECOND workout of a day earns no second workout coin', () => {
    const events = [{ kind: 'workout_complete', source_id: '2026-08-06' }];
    expect(sessionCoins({ ...base, events })).toEqual({ amount: 0, blocked: 'already_banked' });
  });

  it('yesterday’s claim does not block today', () => {
    const events = [{ kind: 'workout_complete', source_id: '2026-08-05' }];
    expect(sessionCoins({ ...base, events })!.amount).toBe(COINS_PER_WORKOUT);
  });

  it('PRs bank on their own, even on an already-banked day', () => {
    const events = [{ kind: 'workout_complete', source_id: '2026-08-06' }];
    expect(sessionCoins({ ...base, events, prCount: 2 })).toEqual({ amount: 2 * COINS_PER_PR, blocked: null });
  });

  it('PRs bank even under the set floor — a PR is its own claim', () => {
    expect(sessionCoins({ ...base, setsToday: 3, prCount: 1 })!.amount).toBe(COINS_PER_PR);
  });

  it('says nothing at all until the history has loaded', () => {
    // A guess here is a fabricated reward. Null renders no coin row.
    expect(sessionCoins({ ...base, events: null })).toBeNull();
  });

  it('is idempotent', () => {
    expect(sessionCoins(base)).toEqual(sessionCoins(base));
  });
});
