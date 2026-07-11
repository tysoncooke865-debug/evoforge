import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * IMPROVEMENT_PLAN #12: the coin ledger's client conventions, cloned from
 * the XP ledger's:
 *   - the total is NULL ON ANY FAILURE, NEVER 0 — a failure rendered as 0
 *     reads as a wiped wallet;
 *   - claims are fire-and-forget: duplicates and guard rejections are
 *     silently absorbed (the server already said no, correctly), only
 *     UNEXPECTED errors toast;
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

/** True when the claim LANDED (a real new row — announce only then). */
export async function claimCoin(kind: CoinKind, sourceId: string): Promise<boolean> {
  const { error } = await supabase.from('coin_events').insert({ kind, amount: 1, source_id: sourceId });
  if (!error) return true;
  // duplicate = already earned; check_violation = guard said not yet. Both
  // are correct outcomes, not errors.
  if (/duplicate|unique|check|not enough|not a PR|not proven|milestone/i.test(error.message)) return false;
  useToastStore.getState().push({ kind: 'error', title: 'COINS NOT BANKED', subtitle: error.message });
  return false;
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
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async ({ kind, sourceId }: { kind: CoinKind; sourceId: string }) => claimCoin(kind, sourceId),
    onSuccess: (landed, { kind }) => {
      if (!landed) return;
      void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
      void queryClient.invalidateQueries({ queryKey: ['coin_events', userId] });
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
    },
  });
}
