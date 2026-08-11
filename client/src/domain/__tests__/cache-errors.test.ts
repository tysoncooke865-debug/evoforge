import { describe, expect, it } from 'vitest';

import { friendlyCacheError } from '../forge-cache-errors';

/**
 * §2 — "Errors must be user-friendly and must never expose raw database errors."
 *
 * The failure this was written after reached a real screen:
 *
 *   null value in column "training_day" of relation "forge_cache_claims"
 *   violates not-null constraint
 *
 * shown verbatim to somebody whose only action was confirming a rest day. The
 * cause is fixed at the source in migration 198; this is the guarantee that no
 * OTHER constraint can ever surface the same way.
 *
 * The distinction that matters: the server's DELIBERATE refusals are written
 * for people and carry the number that explains them, so they must survive
 * intact. Only the accidents get replaced.
 */

describe('friendlyCacheError', () => {
  it('never leaks a constraint violation', () => {
    const raw =
      'null value in column "training_day" of relation "forge_cache_claims" violates not-null constraint';
    const out = friendlyCacheError(raw);
    expect(out).not.toContain('training_day');
    expect(out).not.toContain('constraint');
    expect(out).not.toContain('relation');
    expect(out).toBe('That did not go through. Pull to refresh and try again.');
  });

  it('never leaks a duplicate key, a PostgREST code or a permission error', () => {
    for (const raw of [
      'duplicate key value violates unique constraint "forge_cache_one_per_day"',
      'PGRST202 could not find the function',
      'permission denied for function forge_cache_claim',
    ]) {
      const out = friendlyCacheError(raw);
      expect(out, raw).toBe('That did not go through. Pull to refresh and try again.');
    }
  });

  it('KEEPS the server`s deliberate refusals — they carry the reason', () => {
    expect(
      friendlyCacheError(
        'forge_cache_claim: the weekly cache opens after 3 training days this cycle - you have 1.'
      )
    ).toBe('the weekly cache opens after 3 training days this cycle - you have 1.');
    expect(friendlyCacheError('forge_cache_claim: nothing open yet - train or confirm your rest day.')).toBe(
      'nothing open yet - train or confirm your rest day.'
    );
    expect(
      friendlyCacheError('forge_rest_confirm: your plan has Legs on 2026-08-11, so it is a training day.')
    ).toBe('your plan has Legs on 2026-08-11, so it is a training day.');
  });

  it('says something honest about a dropped connection', () => {
    expect(friendlyCacheError('Failed to fetch')).toContain('No connection');
    expect(friendlyCacheError('network timeout')).toContain('No connection');
  });

  it('is never blank, whatever it is handed', () => {
    for (const raw of [null, undefined, '', '   ']) {
      expect(friendlyCacheError(raw).length).toBeGreaterThan(10);
    }
  });
});
