import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { track } from '@/data/analytics';
import {
  DEFAULT_DUEL_CONFIG,
  type DuelConfig,
  type DuelEvent,
  type DuelReactionKey,
  type OfferKind,
  type Rivalry,
  type SpectatorDuel,
  type WatchableDuel,
} from '@/domain/forge-duel';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * THE FORGE DUEL — the client's thin end for the wager economy.
 *
 * Every mutation is an RPC into migrations 144–146. There is deliberately no
 * client-side settlement, no score submission and no balance arithmetic: the
 * server reads the athletes' own rows and moves the coins, so the worst a
 * tampered client can do is ask for something it is not entitled to.
 *
 * ONE REFRESH FUNCTION. Every duel mutation touches the same four things — the
 * duel list, the coin total, the coin ledger and (for a spectator action) the
 * watched duel. Invalidating a subset is how a pot ends up disagreeing with a
 * wallet on the same screen.
 */

const DUELS = 'forge_challenges';

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** Everything a duel action can change. */
export function refreshDuels(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null,
  challengeId?: string
) {
  void queryClient.invalidateQueries({ queryKey: [DUELS, userId] });
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
  invalidateTable(queryClient, 'coin_events');
  void queryClient.invalidateQueries({ queryKey: ['duels_watchable', userId] });
  void queryClient.invalidateQueries({ queryKey: ['notif_unread', userId] });
  if (challengeId) {
    void queryClient.invalidateQueries({ queryKey: ['duel_timeline', challengeId] });
    void queryClient.invalidateQueries({ queryKey: ['duel_watch', challengeId] });
  }
}

/** Postgres speaks in constraint names; athletes do not. */
function humanise(message: string): string {
  const stripped = message.replace(/^.*?:\s*/, '').trim();
  if (/one_pending|duplicate key/i.test(message)) return 'There is already an offer waiting on this duel.';
  if (/row-level security|violates/i.test(message) && !/coins/i.test(stripped)) {
    return 'You can only duel someone you are friends with.';
  }
  return stripped || 'Something went wrong. Try again.';
}

const fail = (title: string) => (e: Error) =>
  useToastStore.getState().push({ kind: 'error', title, subtitle: humanise(e.message) });

// ───────────────────────────────────────────────────────────── the config

/**
 * THE LIMITS, FROM THE SERVER. The client renders the real numbers rather than
 * a copy that drifts — "Back between 1 and 500" has to be the same 500 the
 * server enforces or the form is lying.
 *
 * Falls back to the shipped defaults on any failure: a missing config must
 * degrade to a working form, never to a blank one.
 */
export function useDuelConfig() {
  return useQuery({
    queryKey: ['duel_config'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DuelConfig> => {
      try {
        const { data, error } = await supabase.rpc('forge_duel_settings');
        if (error || !data) return DEFAULT_DUEL_CONFIG;
        const row = Array.isArray(data) ? data[0] : data;
        return { ...DEFAULT_DUEL_CONFIG, ...(row as Partial<DuelConfig>) };
      } catch {
        return DEFAULT_DUEL_CONFIG;
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────── the sweep

/**
 * HOUSEKEEPING NOBODY SHOULD HAVE TO ASK FOR.
 *
 * Expires dead invites and offers and settles any duel whose window closed, so
 * a duel that ended overnight is already settled by the time the hub is looked
 * at. Fired once per hub mount and deliberately silent: it is maintenance, and
 * the RESULT is what the athlete came to see.
 */
export function useDuelSweep() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (): Promise<{ settled: number; expired: number }> => {
      const { data, error } = await supabase.rpc('forge_duel_sweep');
      if (error) throw error;
      return data as { settled: number; expired: number };
    },
    onSuccess: (r) => {
      if (r.settled > 0 || r.expired > 0) refreshDuels(queryClient, userId);
      if (r.settled > 0) track('challenge_completed', { swept: r.settled });
    },
    // A failed sweep is invisible on purpose: nothing the athlete asked for
    // has failed, and every duel it would have settled settles on the next open.
    onError: () => undefined,
  });
}

// ──────────────────────────────────────────────────────── offers

export interface ProposeInput {
  challengeId: string;
  kind: OfferKind;
  /** Ignored by the server for `all_in` — the amount is the ledger. */
  amount?: number;
  counterOf?: string | null;
}

export interface OfferResult {
  offer_id: string;
  kind: OfferKind;
  amount: number;
  pot_if_accepted: number;
  opponent_can_match: boolean | null;
}

export function useProposeOffer() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: ProposeInput): Promise<OfferResult> => {
      const { data, error } = await supabase.rpc('forge_duel_propose', {
        p_challenge: input.challengeId,
        p_kind: input.kind,
        p_amount: input.amount ?? null,
        p_counter_of: input.counterOf ?? null,
      });
      if (error) throw error;
      return data as OfferResult;
    },
    onSuccess: (r, input) => {
      refreshDuels(queryClient, userId, input.challengeId);
      track('duel_offer_proposed', {
        challenge_id: input.challengeId, kind: input.kind, amount: r.amount,
        countered: Boolean(input.counterOf),
      });
      useToastStore.getState().push({
        kind: 'info',
        title: input.kind === 'all_in' ? 'ALL IN SENT' : input.counterOf ? 'COUNTER SENT' : 'RAISE SENT',
        subtitle:
          r.opponent_can_match === false
            ? `They only need to accept — but they cannot cover ${r.amount} right now.`
            : 'No coins move until they accept.',
      });
    },
    onError: fail('OFFER NOT SENT'),
  });
}

export function useRespondOffer() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { offerId: string; accept: boolean; challengeId: string }) => {
      const { data, error } = await supabase.rpc('forge_duel_respond', {
        p_offer: input.offerId,
        p_accept: input.accept,
      });
      if (error) throw error;
      return data as {
        status: string; already?: boolean; refused?: boolean; reason?: string;
        pot?: number; amount?: number; stake?: number;
      };
    },
    onSuccess: (r, input) => {
      refreshDuels(queryClient, userId, input.challengeId);
      // REFUSED IS NOT DONE. The offer was replaced, withdrawn or expired
      // between the screen painting and the tap; saying "accepted" here would
      // be the one lie this system cannot afford.
      if (r.refused) {
        useToastStore.getState().push({ kind: 'error', title: 'TERMS CHANGED', subtitle: r.reason ?? '' });
        return;
      }
      if (r.already) return;
      track(input.accept ? 'duel_offer_accepted' : 'duel_offer_declined', {
        challenge_id: input.challengeId, amount: r.amount ?? r.stake ?? 0,
      });
      useToastStore.getState().push(
        input.accept
          ? { kind: 'achievement', title: 'POT RAISED', subtitle: `${r.pot ?? 0} coins on the line.` }
          : { kind: 'info', title: 'RAISE DECLINED', subtitle: 'The duel carries on unchanged.' }
      );
    },
    onError: fail('NOT DONE'),
  });
}

export function useWithdrawOffer() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { offerId: string; challengeId: string }) => {
      const { data, error } = await supabase.rpc('forge_duel_withdraw_offer', { p_offer: input.offerId });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: (_r, input) => refreshDuels(queryClient, userId, input.challengeId),
    onError: fail('NOT WITHDRAWN'),
  });
}

// ─────────────────────────────────────────────────────────────── support

export function useSupportDuel() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { challengeId: string; backedId: string; amount: number }) => {
      const { data, error } = await supabase.rpc('forge_duel_support', {
        p_challenge: input.challengeId,
        p_backed: input.backedId,
        p_amount: input.amount,
      });
      if (error) throw error;
      return data as { ok: boolean; amount: number };
    },
    onSuccess: (r, input) => {
      refreshDuels(queryClient, userId, input.challengeId);
      track('duel_support_placed', { challenge_id: input.challengeId, amount: r.amount });
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'BACKED',
        subtitle: `${r.amount} coins on your pick. Winners split the other side's pool.`,
      });
    },
    onError: fail('NOT BACKED'),
  });
}

export function useReactToDuel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { challengeId: string; emoji: DuelReactionKey; on: boolean }) => {
      const { error } = await supabase.rpc('forge_duel_react', {
        p_challenge: input.challengeId,
        p_emoji: input.emoji,
        p_on: input.on,
      });
      if (error) throw error;
    },
    onSuccess: (_r, input) => {
      void queryClient.invalidateQueries({ queryKey: ['duel_watch', input.challengeId] });
    },
    // A reaction that fails is a reaction that did not happen. No toast: it is
    // the smallest thing on the screen and does not deserve an error dialog.
    onError: () => undefined,
  });
}

// ───────────────────────────────────────────────────────────────── reads

export function useDuelTimeline(challengeId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['duel_timeline', challengeId],
    enabled: enabled && Boolean(challengeId),
    // Live surfaces, not cacheable pages — see the note on useForgeChallenges.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<DuelEvent[]> => {
      const { data, error } = await supabase.rpc('forge_duel_timeline', {
        p_challenge: challengeId,
        p_limit: 40,
      });
      if (error) throw error;
      return (data ?? []) as DuelEvent[];
    },
  });
}

/** My friends' live duels — never my own; those are already on the hub. */
export function useWatchableDuels() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['duels_watchable', userId],
    enabled: userId !== null,
    // Someone else's duel moves slower than my own; 15s is fresh enough for a
    // list and does not add a request to every hub paint.
    staleTime: 15_000,
    queryFn: async (): Promise<WatchableDuel[]> => {
      const { data, error } = await supabase.rpc('forge_duels_watchable', { p_limit: 12 });
      // A missing function must read as "nothing to watch", not as a broken
      // hub: the rest of the page is the athlete's own duels and still works.
      if (error) return [];
      return (data ?? []) as WatchableDuel[];
    },
  });
}

export function useDuelWatch(challengeId: string | null) {
  return useQuery({
    queryKey: ['duel_watch', challengeId],
    enabled: Boolean(challengeId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<SpectatorDuel> => {
      const { data, error } = await supabase.rpc('forge_duel_watch', { p_challenge: challengeId });
      if (error) throw error;
      return data as SpectatorDuel;
    },
  });
}

/** Head-to-head against one athlete, computed from the duels themselves. */
export function useRivalry(otherId: string | null) {
  return useQuery({
    queryKey: ['duel_rivalry', otherId],
    enabled: Boolean(otherId),
    queryFn: async (): Promise<Rivalry | null> => {
      const { data, error } = await supabase.rpc('forge_rivalry', { p_other: otherId });
      if (error) return null;
      return data as Rivalry;
    },
  });
}
