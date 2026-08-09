import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { classifyClaimError, type ClaimOutcome } from '@/domain/coin-claims';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * IMPROVEMENT_PLAN #12: the coin ledger's client conventions, cloned from
 * the XP ledger's:
 *   - the total is NULL ON ANY FAILURE, NEVER 0 — a failure rendered as 0
 *     reads as a wiped wallet;
 *   - claims are fire-and-forget: duplicates and guard rejections are
 *     absorbed (the server already said no, correctly), only UNEXPECTED
 *     errors toast — with ONE honest exception (HOME v2, 2026-07-22): a
 *     finished workout under the 10-set coin floor tells the athlete why
 *     nothing banked, because that silence read as "coins are broken";
 *   - the client's amount is a placeholder — the 013 guard recomputes it.
 */

export function useCoinTotal() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['coin_total', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<number | null> => {
      try {
        // EXACT, WITH CENTS. `coin_total()` still exists and still returns a
        // floored integer for the nineteen server functions that gate a spend
        // on it — this is the reading a human is shown.
        const { data, error } = await supabase.rpc('coin_total_exact');
        if (error) return null;
        // Number(null) is 0 — an absent body must read as failure (null),
        // never as an empty wallet. Same guard as useLedgerXp.
        if (data === null || data === undefined) return null;
        const n = Number(data);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    },
  });
}

export interface CoinEvent {
  id: string;
  kind: string;
  amount: number;
  source_id: string | null;
  created_at: string;
}

export function useCoinHistory() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['coin_events', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<CoinEvent[]> => {
      const { data, error } = await supabase
        .from('coin_events')
        .select('id,kind,amount,source_id,created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as CoinEvent[];
    },
  });
}

export type CoinKind =
  | 'workout_complete'
  | 'pr'
  | 'streak_milestone'
  | 'starting_bonus'
  // 160 — v5 §2's per-set income. Athlete-claimable like the rest of this
  // union: the guard prices it and the unique index on (user_id, kind,
  // source_id) makes one payment per logged set a database fact.
  | 'set_reward';

/** The classified claim result — 'landed' means a real new row (announce
 *  only then). Refusals come back NAMED (domain/coin-claims.ts) so callers
 *  can be honest where it matters; only 'error' toasts here. */
/**
 * WHAT EACH KIND PAYS, as the athlete is told.
 *
 * A SECOND COPY OF THE SERVER'S AMOUNTS, and there is no way around that: the
 * toast has to name a number before the ledger has been re-read. Nothing FAILS
 * when it drifts, which is exactly the danger — the ledger stays right and the
 * toast simply lies, on the one surface an athlete uses to check what they earned.
 * `tools/falsify-coin-labels.mjs` reads the live guard body and compares.
 *
 * IT IS EXPORTED because there were three copies. 160 retuned pr from 50 to 25
 * and this map was updated; two hardcoded '+50' strings in mutations.ts and
 * set-queue.ts were not, so every PR toast on both save paths had been
 * overstating by 25 coins since that migration.
 */
export const COIN_AMOUNTS: Record<CoinKind, string> = {
  workout_complete: '+20',
  pr: '+25',
  streak_milestone: '+',
  starting_bonus: '+100',
  set_reward: '+12',
};

/**
 * THE PER-SET REWARD (160), claimed quietly.
 *
 * v5 §2 wants the large majority of a day's coins to come from predictable,
 * effort-linked work rather than from anything variable, and 12 coins a set is
 * what carries that. The kind, the server validation and the 30-a-day cap all
 * shipped in 160 — NOTHING EVER CLAIMED IT, so it had paid out zero coins in
 * production. The backbone of the economy existed only as a guard.
 *
 * NO TOAST, deliberately. A notification on every single set is the opposite of
 * the calm, predictable income the spec describes; the coin total updates and
 * that is the feedback. Failures are swallowed for the same reason the PR claim
 * swallows them — the set is already saved, and the daily cap refusing the 31st
 * set is normal, not an error worth interrupting a workout for.
 */
export async function claimSetReward(rowId: string): Promise<void> {
  try {
    await claimCoin('set_reward', rowId);
  } catch {
    /* the set is safe; coins are not worth a failure surface mid-workout */
  }
}

export async function claimCoin(kind: CoinKind, sourceId: string): Promise<ClaimOutcome> {
  const { error } = await supabase.from('coin_events').insert({ kind, amount: 1, source_id: sourceId });
  if (!error) return { outcome: 'landed' };
  const result = classifyClaimError(error.message);
  if (result.outcome === 'error') {
    useToastStore.getState().push({ kind: 'error', title: 'COINS NOT BANKED', subtitle: result.message });
  }
  return result;
}

export const COIN_LABELS: Record<string, string> = {
  workout_complete: 'Workout complete',
  pr: 'Personal record',
  streak_milestone: 'Streak milestone',
  starting_bonus: 'Starting bonus',
  adjustment: 'Adjustment',
  spend: 'Spent',
  // 139/144 — the duel's four server-only kinds. They are never claimed from
  // here (the guard admits them solely inside the duel functions), but the
  // ledger screen renders whatever the ledger holds, and an unlabelled row
  // reads as a bug in the one place an athlete goes to check their coins.
  battle_reward: 'Battle reward',
  challenge_stake: 'Duel pledge',
  challenge_payout: 'Duel settlement',

  // 151 — LIVE WORKOUT CALL OUTS. Server-only like the duel's kinds (the guard
  // admits them solely inside the callout functions), but the ledger screen
  // renders whatever the ledger holds, and an unlabelled row reads as a bug in
  // the one place an athlete goes to check their coins.
  callout_stake: 'Trial pledge',
  callout_payout: 'Trial settlement',
  // 154 — FORGE DROP. Same rule again: server-only, guard-admitted, and the
  // ledger screen is exactly where somebody goes to check what a board
  // actually paid them. This is the third of the THREE EDITS a coin kind
  // needs (CHECK constraint, guard branch, client label) and it is the one
  // that gets forgotten, because nothing fails without it — the row just
  // renders blank in the one place it matters.
  forge_drop_stake: 'Retired board — pledge',
  forge_drop_payout: 'Retired board — return',
  // 159 — A BOARD BOUGHT EARLY. And the third edit was forgotten AGAIN, one
  // migration after the comment above was written about forgetting it: 159 added
  // the kind to the CHECK constraint and the guard branch and stopped there, so
  // the single largest debit in the game — 75,000 coins for MYTHIC CELESTIAL
  // FORGE — would have rendered as a blank line. Nothing failed; that is the
  // whole problem with this edit. tools/falsify-forge-drop.mjs §10 caught it by
  // reading the live constraint against this map, which is why that check reads
  // EVERY kind rather than the ones a session happens to remember.
  forge_drop_unlock: 'Retired board — unlock',
  // 160 — the deterministic backbone (v5 §2).
  set_reward: 'Set logged',
  // 161 — THE REVEAL, and this label was forgotten too. A THIRD time: 139 taught
  // the guard and not the constraint, 159 taught both and not the label, and 161
  // taught constraint + guard + a CHECK enforcing invariant 1 and still stopped
  // one line short of the word an athlete reads. Nothing failed either time,
  // which is the whole problem — tools/falsify-coin-labels.mjs exists because
  // only a machine comparing the live constraint against this map ever notices.
  reveal_bonus: 'Forge bonus',
  // 166 — §6's deterministic ladder and floor. Caught unlabelled by
  // tools/falsify-coin-labels.mjs on the run right after the migration, which
  // is the fourth time this edit has been missed and the second time the tool
  // has been the only thing that noticed.
  forge_cache: 'Daily Forge Cache',
  recovery_cache: 'Recovery Cache',
};

/** Claim + refresh + announce, from any screen. */
export function useClaimCoin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, sourceId }: { kind: CoinKind; sourceId: string }) => claimCoin(kind, sourceId),
    onSuccess: (result, { kind }) => {
      if (result.outcome === 'landed') {
        // PREFIX invalidation via the keys doctrine (not userId-keyed): a
        // claim landing during a token-refresh blip used to invalidate
        // ['coin_total', null] and leave the real counter stale.
        invalidateTable(queryClient, 'coin_events');
        // THE FOURTH EDIT, and it is not on anybody's list of three. These
        // strings are a SECOND COPY of the server's amounts, and 160 retuned two
        // of them (workout_complete 25->20, pr 50->25). Nothing fails when they
        // drift: the ledger stays right and the toast simply lies about it, in
        // the one surface an athlete uses to check what they earned.
        useToastStore.getState().push({
          kind: 'info',
          title: `COINS BANKED ${COIN_AMOUNTS[kind] ?? '+'}`,
          subtitle: COIN_LABELS[kind],
        });
        return;
      }
      // THE honest exception: a finished workout under the coin floor. The
      // server is the authority on the number; this string just repeats it.
      if (
        result.outcome === 'rejected' &&
        result.reason === 'not_enough_training' &&
        kind === 'workout_complete'
      ) {
        useToastStore.getState().push({
          kind: 'info',
          title: 'NO COINS YET',
          subtitle: 'Coins bank at 10+ counted sets in a day.',
        });
      }
      // Everything else (duplicates, non-PRs, unproven milestones) stays
      // silent — the athlete did nothing just now that deserves a nag.
    },
  });
}
