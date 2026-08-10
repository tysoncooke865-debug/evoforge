import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * FORGE POOLS — the client's side of migrations 180–184.
 *
 * A pool is an ordinary call out that friends may join. The athlete pledges on
 * their own upcoming set, names who gets asked, and each of those friends takes a
 * side on THAT proposition: BACK (they make it) or PUSH (they do not). Nobody
 * invents their own target — a set settles against one number.
 *
 * TWO RULES ARE ENFORCED SERVER-SIDE AND MIRRORED HERE ONLY SO THE SCREEN AGREES:
 *
 *   FRIENDS OF THE ATHLETE, and nobody else. Re-checked at join time, because
 *   friendship can end between the invitation and the join.
 *
 *   INVITE-ONLY. There is deliberately NO browsable list of open pools, and
 *   migration 182 asserts none exists. A scrollable feed of things to put coins on
 *   is what a betting lobby looks like; this is an inbox of invitations from people
 *   you know. Do not add a discovery surface here.
 *
 * Nothing in this file may take a cut, and there is no code path that could — the
 * server divides the losing side in proportion and asserts conservation before it
 * commits.
 */

const INVITES_KEY = 'pool_invitations';
const POOL_KEY = 'callout_pool';

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** One side of the scale, as the server reports it. */
export interface PoolTotals {
  mode: 'duel' | 'pot';
  back: number;
  push: number;
  total: number;
  joiners: number;
}

/** An invitation, or a position already taken. `my_side` is null until you join. */
export interface PoolInvitation {
  callout_id: string;
  athlete_id: string;
  athlete_name: string;
  /** 186: the PUSH pan's anchor — the opponent's stake is on the callout row. */
  opponent_id: string;
  exercise: string;
  target_label: string;
  workout_date: string;
  set_no: number;
  status: string;
  expires_at: string;
  back_total: number;
  push_total: number;
  joiners: number;
  my_side: 'back' | 'push' | null;
  my_stake: number | null;
}

/**
 * POOLS I HAVE BEEN ASKED TO JOIN, and the ones I am already in.
 *
 * Empty is the overwhelmingly common answer and must cost nothing to render — the
 * chip that shows this returns null on an empty list rather than an empty state,
 * for the same reason the reveal chip does: an invitation nobody sent is not news.
 */
export function usePoolInvitations() {
  const userId = useUserId();
  return useQuery({
    queryKey: [INVITES_KEY, userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<PoolInvitation[]> => {
      const { data, error } = await supabase.rpc('my_pool_invitations');
      // A missing migration reads as "nothing here", never as an error an athlete
      // has to think about. Anything else would put a red toast on Home for a
      // feature they may never have used.
      if (error) return [];
      return (data ?? []) as PoolInvitation[];
    },
  });
}

/**
 * WHO IS IN, AND FOR HOW MUCH — one row per joiner.
 *
 * Read straight from `workout_callout_entries`: RLS (180) already lets everybody in
 * a pool see every position in it, which §5 requires — an anonymous pool cannot
 * carry owner identification on its ingots, and the sides are the proposition.
 *
 * NO NAMES. The scale tints each ingot by a colour derived from the user id, so it
 * never needs one, and asking for names here would mean a join and a definer
 * function for information the picture does not use.
 */
export function usePoolPositions(calloutId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['pool_positions', userId, calloutId],
    enabled: Boolean(userId && calloutId),
    staleTime: 15_000,
    queryFn: async (): Promise<{ user_id: string; side: 'back' | 'push'; stake: number }[]> => {
      const { data, error } = await supabase
        .from('workout_callout_entries')
        .select('user_id, side, stake')
        .eq('callout_id', calloutId)
        .order('joined_at');
      if (error) return [];
      return (data ?? []) as { user_id: string; side: 'back' | 'push'; stake: number }[];
    },
  });
}

/** One person's outcome on a settled call out. `net` is up or down, from the ledger. */
export interface SettlementLine {
  user_id: string;
  display_name: string;
  side: 'back' | 'push';
  staked: number;
  net: number;
}

/**
 * WHO ENDED UP WHERE (§5: per-person ledger lines, not ingots sweeping to a winner).
 *
 * `net` is `sum(coin_events.amount)` for the call out — the only source that covers
 * BOTH principals and joiners. `workout_callout_entries.payout` exists but only
 * joiners have an entry row, so a screen built on it would silently omit the athlete
 * and their opponent, who are usually the largest positions in the pool.
 *
 * The lines sum to zero on a settled pool, because nothing is minted and nothing is
 * taken. Migration 187 asserts that against real settled rows.
 */
export function usePoolSettlement(calloutId: string | null, enabled = true) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['pool_settlement', userId, calloutId],
    enabled: Boolean(userId && calloutId && enabled),
    // A settled pool never changes again, so this is worth holding on to.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SettlementLine[]> => {
      const { data, error } = await supabase.rpc('callout_settlement', { p_callout: calloutId });
      if (error) return [];
      return (data ?? []) as SettlementLine[];
    },
  });
}

/** The live totals for one call out — the two pans. */
export function useCalloutPool(calloutId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: [POOL_KEY, userId, calloutId],
    enabled: Boolean(userId && calloutId),
    staleTime: 15_000,
    queryFn: async (): Promise<PoolTotals | null> => {
      const { data, error } = await supabase.rpc('callout_pool', { p_callout: calloutId });
      if (error) return null;
      return (data ?? null) as PoolTotals | null;
    },
  });
}

function refresh(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  void queryClient.invalidateQueries({ queryKey: [INVITES_KEY, userId] });
  void queryClient.invalidateQueries({ queryKey: [POOL_KEY, userId] });
  void queryClient.invalidateQueries({ queryKey: ['pool_positions', userId] });
  void queryClient.invalidateQueries({ queryKey: ['workout_callouts', userId] });
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
}

/**
 * OPEN MY OWN SET TO A POOL, and ask some friends.
 *
 * Idempotent server-side: opening an already-open pool adds whoever is new to the
 * invitation list, so a double tap is not an error and does not notify twice.
 */
export function useOpenPool() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({ calloutId, invitees }: { calloutId: string; invitees: string[] }) => {
      const { data, error } = await supabase.rpc('callout_pool_open', {
        p_callout: calloutId,
        p_invitees: invitees,
      });
      if (error) throw new Error(error.message);
      return data as { mode: string; invited: number; skipped: number };
    },
    onSuccess: (r, input) => {
      refresh(queryClient, userId);
      track('callout_pool_opened', { invited: r.invited, skipped: r.skipped });
      useToastStore.getState().push({
        kind: 'info',
        title: r.invited > 0 ? 'FRIENDS ASKED' : 'POOL OPEN',
        subtitle:
          r.invited > 0
            ? `${r.invited} ${r.invited === 1 ? 'friend' : 'friends'} can now take a side.`
            : 'Ask a friend whenever you like.',
      });
      void input;
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT OPEN IT', subtitle: e.message });
    },
  });
}

/**
 * TAKE A SIDE ON SOMEBODY ELSE'S SET.
 *
 * The coins leave the wallet here, not at settlement — the server escrows in the
 * same transaction as the position, so there is no state where somebody holds a
 * side they have not paid for.
 */
export function useJoinPool() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({
      calloutId,
      side,
      stake,
    }: {
      calloutId: string;
      side: 'back' | 'push';
      stake: number;
    }) => {
      const { data, error } = await supabase.rpc('callout_pool_join', {
        p_callout: calloutId,
        p_side: side,
        p_stake: stake,
      });
      if (error) throw new Error(error.message);
      return data as { joined: boolean; already: boolean; pool: PoolTotals };
    },
    onSuccess: (r, input) => {
      refresh(queryClient, userId);
      if (r.already) return; // a double tap is not news
      track('callout_pool_joined', { side: input.side, stake: input.stake });
      useToastStore.getState().push({
        kind: 'info',
        title: input.side === 'back' ? 'BACKING THEM' : 'PUSHING BACK',
        subtitle: `${input.stake} coins in. Settles on their logged set.`,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT JOIN', subtitle: e.message });
    },
  });
}
