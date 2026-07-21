import { describe, expect, it } from 'vitest';

import { classifyClaimError } from '../coin-claims';

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
