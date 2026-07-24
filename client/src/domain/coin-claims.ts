/**
 * COIN CLAIM OUTCOMES (HOME v2, 2026-07-22). The 013 guard says "no" in
 * words — duplicates, the ≥10-set floor, unproven PRs/milestones — and the
 * client used to compress every refusal into `false`, indistinguishable
 * from success-already-had. That silence read as "coins aren't logging".
 *
 * This module NAMES the refusals so the data layer can be honest about the
 * one that matters (a finished workout that didn't earn) while staying
 * silent about the ones that don't (reload duplicates, non-PRs). The
 * classification set exactly preserves the old silent-absorb regex — no
 * refusal that was absorbed before can toast as an error now.
 */

export type ClaimOutcome =
  | { outcome: 'landed' }
  /** Already earned — the unique index said so. Correct and silent. */
  | { outcome: 'duplicate' }
  /** The guard said "not yet", with a nameable reason. */
  | {
      outcome: 'rejected';
      reason: 'not_enough_training' | 'not_a_pr' | 'milestone_not_proven' | 'guard';
    }
  /** Unexpected — the only case that should toast as an error. */
  | { outcome: 'error'; message: string };

/** Classify a coin_events insert error message (the 013/033/061 guard's
 *  literal raise strings + the unique-index violation). Order matters: the
 *  specific reasons are matched before the generic check_violation net. */
export function classifyClaimError(message: string): ClaimOutcome {
  const m = message ?? '';
  if (/duplicate|unique|already exists/i.test(m)) return { outcome: 'duplicate' };
  if (/not enough training/i.test(m)) return { outcome: 'rejected', reason: 'not_enough_training' };
  if (/not a PR/i.test(m)) return { outcome: 'rejected', reason: 'not_a_pr' };
  if (/not proven|milestone/i.test(m)) return { outcome: 'rejected', reason: 'milestone_not_proven' };
  if (/check/i.test(m)) return { outcome: 'rejected', reason: 'guard' };
  // Every literal the 013/033/061 guard raises is prefixed 'coin_events:' — a
  // refusal this module doesn't yet name by reason (a malformed source_id, no
  // matching owned row, a kind gated to the server, ...) is still the GUARD
  // saying no, not a real failure. It fell through here silently as a false
  // "COINS NOT BANKED" error before this case existed (2026-07-24) — a race
  // between a queued set and its own PR claim hit exactly this path. Only a
  // message that ISN'T the guard's own voice (RLS, network, a dropped column)
  // is truly unexpected.
  if (/^coin_events:/i.test(m)) return { outcome: 'rejected', reason: 'guard' };
  return { outcome: 'error', message: m };
}
