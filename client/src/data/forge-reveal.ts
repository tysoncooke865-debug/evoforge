import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  DEFAULT_REVEAL_TABLE,
  type BankedReveal,
  type ClaimedReveal,
  type RevealOutcome,
} from '@/domain/forge-reveal';
import { useToastStore } from '@/state/toast-store';

import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * THE REVEAL, SERVER-SIDE (Spec v5 §3).
 *
 * One read for everything the UI needs — what is banked, the published table, and
 * the balance — because a table from one moment beside a balance from another is
 * how a screen shows odds the server is no longer offering.
 *
 * THERE IS NO GRANT HOOK HERE, AND THERE MUST NOT BE. `forge_reveal_grant` is
 * revoked from `authenticated` in 161: reveals are produced by completing a workout
 * or setting a qualifying PR, server-side and silently. A client that could grant
 * itself one would be a third producer, and §3 closes the set at two.
 */

export interface RevealState {
  banked: BankedReveal[];
  table: RevealOutcome[];
  tableTotal: number;
  balance: number;
}

export const revealKey = (userId: string | null) => ['forge_reveals', userId] as const;

export function useMyReveals(userId: string | null) {
  return useQuery({
    queryKey: revealKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<RevealState> => {
      const { data, error } = await supabase.rpc('my_forge_reveals');
      if (error) throw error;
      const d = (data ?? {}) as {
        banked?: BankedReveal[];
        table?: RevealOutcome[];
        table_total?: number;
        balance?: number;
      };
      return {
        banked: d.banked ?? [],
        // Fall back to the shipped table rather than an empty one: §3 requires the
        // odds be visible BEFORE every reveal, and a blank where the numbers should
        // be is worse than numbers a moment early. The suite pins the two together.
        table: d.table?.length ? d.table : DEFAULT_REVEAL_TABLE,
        tableTotal: Number(d.table_total ?? 1000),
        balance: Number(d.balance ?? 0),
      };
    },
  });
}

/**
 * CLAIM ONE.
 *
 * ONE ARGUMENT, AND IT IS AN IDENTIFIER — mirroring 161's signature, which is
 * where invariant 1 is actually enforced. There is no amount to send and no stake
 * to attach; the server draws, stores and returns the outcome, and the animation
 * replays a decided fact.
 *
 * Idempotent end to end: a doubled tap, a refresh mid-animation or an offline retry
 * all return the same outcome with `replayed: true` and write no second ledger row.
 * So the mutation does NOT need to guard against double submission — and must not
 * pretend to, because a client-side lock that fails open would be the only thing
 * standing if the server guarantee were ever weakened.
 */
export function useClaimReveal(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (revealId: string): Promise<ClaimedReveal> => {
      const { data, error } = await supabase.rpc('forge_reveal_claim', {
        p_reveal_id: revealId,
      });
      if (error) throw error;
      return data as ClaimedReveal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: revealKey(userId) });
      invalidateTable(queryClient, 'coin_events');
    },
    onError: (e: unknown) => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'REVEAL NOT CLAIMED',
        subtitle: e instanceof Error ? e.message : 'Try again in a moment.',
      });
    },
  });
}
