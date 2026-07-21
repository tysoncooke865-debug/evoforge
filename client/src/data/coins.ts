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
        const { data, error } = await supabase.rpc('coin_total');
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

export type CoinKind = 'workout_complete' | 'pr' | 'streak_milestone' | 'starting_bonus';

/** The classified claim result — 'landed' means a real new row (announce
 *  only then). Refusals come back NAMED (domain/coin-claims.ts) so callers
 *  can be honest where it matters; only 'error' toasts here. */
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
        const amounts: Record<CoinKind, string> = {
          workout_complete: '+25',
          pr: '+50',
          streak_milestone: '+',
          starting_bonus: '+100',
        };
        useToastStore.getState().push({
          kind: 'info',
          title: `COINS BANKED ${amounts[kind] ?? '+'}`,
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
