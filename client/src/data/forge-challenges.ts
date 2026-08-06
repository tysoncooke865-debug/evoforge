import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { track } from '@/data/analytics';
import type {
  ChallengeDuration,
  ChallengeStake,
  ChallengeType,
  ForgeChallenge,
} from '@/domain/forge-challenge';
import { todayIso } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * FORGE CHALLENGES — the client's thin end.
 *
 * Every mutation here is an RPC into migrations 139–142. There is deliberately
 * NO client-side settle, no score submission and no balance arithmetic: the
 * server reads the athletes' own rows and moves the coins, so the worst a
 * tampered client can do is ask for something it is not entitled to and be
 * refused.
 *
 * The one direct table write is CREATE, and its RLS policy fences it to
 * "as myself, to a friend, status pending".
 */

const KEY = 'forge_challenges';

export function useForgeChallenges() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: [KEY, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ForgeChallenge[]> => {
      const { data, error } = await supabase.rpc('my_forge_challenges');
      if (error) {
        // The migration is not applied yet: an empty list is the honest
        // answer ("you have no challenges"), and the feature flag keeps the
        // tab hidden anyway. EVERYTHING ELSE THROWS — a swallowed failure
        // would cache [] and make a real challenge disappear.
        if (/does not exist|schema cache|PGRST202|PGRST205/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as ForgeChallenge[];
    },
  });
}

/** Everything a challenge touches: the list, the coin balance and its ledger. */
function refreshAfterChallenge(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  void queryClient.invalidateQueries({ queryKey: [KEY, userId] });
  invalidateTable(queryClient, 'coin_events');
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
}

export interface CreateChallengeInput {
  opponentId: string;
  challengeType: ChallengeType;
  metricKey: string | null;
  durationDays: ChallengeDuration;
  stake: ChallengeStake;
  /** Set when this is a rematch of a finished challenge. */
  rematchOf?: string | null;
}

export function useCreateChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: CreateChallengeInput): Promise<string> => {
      const { data, error } = await supabase
        .from('forge_challenges')
        .insert({
          opponent_id: input.opponentId,
          challenge_type: input.challengeType,
          metric_key: input.metricKey,
          duration_days: input.durationDays,
          stake: input.stake,
          rematch_of: input.rematchOf ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return String(data.id);
    },
    onSuccess: (id, input) => {
      refreshAfterChallenge(queryClient, userId);
      track('challenge_created', {
        challenge_id: id,
        challenge_type: input.challengeType,
        duration_days: input.durationDays,
        stake: input.stake,
        is_rematch: Boolean(input.rematchOf),
      });
      useToastStore.getState().push({
        kind: 'info',
        title: 'CHALLENGE SENT',
        subtitle: 'No coins move until they accept.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'CHALLENGE NOT SENT',
        // The RLS policy speaks in Postgres; say what it means.
        subtitle: /row-level security|violates/i.test(e.message)
          ? 'You can only challenge someone you are friends with.'
          : e.message,
      });
    },
  });
}

/** The shape every state-changing RPC returns. */
interface ChallengeResult {
  status: string;
  already?: boolean;
  outcome?: string | null;
  winner_id?: string | null;
  escrow?: number;
  refunded?: number;
  note?: string;
}

export function useAcceptChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (challengeId: string): Promise<ChallengeResult> => {
      // THE ATHLETE'S LOCAL DAY (143). The window is compared against
      // workout_log.date / cardio_log.date, which this app writes as the LOCAL
      // calendar day — a UTC-anchored window is a day out at both ends, and
      // rendered "DAY 2 OF 7" on day one for anyone east of Greenwich. The
      // server validates it: more than a day from its own clock is not a
      // timezone, and falls back to UTC.
      const { data, error } = await supabase.rpc('forge_challenge_accept', {
        p_challenge: challengeId,
        p_local_date: todayIso(),
      });
      if (error) throw error;
      return data as ChallengeResult;
    },
    onSuccess: (r, challengeId) => {
      refreshAfterChallenge(queryClient, userId);
      // `already` means a previous tap won the race. Success either way — the
      // athlete's intent is satisfied and nothing was escrowed twice.
      if (r.already) return;
      track('challenge_accepted', { challenge_id: challengeId, escrow: r.escrow ?? 0 });
      useToastStore.getState().push({
        kind: 'info',
        title: 'CHALLENGE ACCEPTED',
        subtitle: `${r.escrow ?? 0} coins are in escrow. Train.`,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT ACCEPTED',
        subtitle: e.message.replace(/^.*?:\s*/, ''),
      });
    },
  });
}

export function useDeclineChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (challengeId: string): Promise<ChallengeResult> => {
      const { data, error } = await supabase.rpc('forge_challenge_decline', { p_challenge: challengeId });
      if (error) throw error;
      return data as ChallengeResult;
    },
    onSuccess: (_r, challengeId) => {
      refreshAfterChallenge(queryClient, userId);
      track('challenge_rejected', { challenge_id: challengeId });
    },
  });
}

export function useCancelChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (challengeId: string): Promise<ChallengeResult> => {
      const { data, error } = await supabase.rpc('forge_challenge_cancel', { p_challenge: challengeId });
      if (error) throw error;
      return data as ChallengeResult;
    },
    onSuccess: (r, challengeId) => {
      refreshAfterChallenge(queryClient, userId);
      if (r.already) return;
      track('coins_refunded', { challenge_id: challengeId, amount: r.refunded ?? 0 });
      useToastStore.getState().push({
        kind: 'info',
        title: 'CHALLENGE CANCELLED',
        subtitle: r.refunded ? `${r.refunded} coins refunded to each of you.` : 'No coins were staked.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT CANCELLED', subtitle: e.message });
    },
  });
}

/**
 * SETTLE. The client asks; the SERVER computes both scores from the logged
 * rows and moves the escrow. Nothing about the result is sent from here, and
 * a repeat call returns the recorded outcome without paying again.
 */
export function useSettleChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (challengeId: string): Promise<ChallengeResult> => {
      const { data, error } = await supabase.rpc('forge_challenge_settle', { p_challenge: challengeId });
      if (error) throw error;
      return data as ChallengeResult;
    },
    onSuccess: (r, challengeId) => {
      refreshAfterChallenge(queryClient, userId);
      if (r.already || r.status !== 'settled') return;
      const won = r.winner_id === userId;
      track('challenge_completed', { challenge_id: challengeId, outcome: r.outcome ?? 'unknown' });
      track(won ? 'challenge_won' : r.outcome === 'draw' ? 'challenge_drawn' : 'challenge_lost', {
        challenge_id: challengeId,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT SETTLED',
        subtitle: e.message.replace(/^.*?:\s*/, ''),
      });
    },
  });
}

export function useDisputeChallenge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async ({ challengeId, reason }: { challengeId: string; reason: string }) => {
      const { data, error } = await supabase.rpc('forge_challenge_dispute', {
        p_challenge: challengeId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as ChallengeResult;
    },
    onSuccess: (_r, { challengeId }) => {
      refreshAfterChallenge(queryClient, userId);
      track('challenge_disputed', { challenge_id: challengeId });
      useToastStore.getState().push({
        kind: 'info',
        title: 'DISPUTE RAISED',
        subtitle: 'Settlement is paused until it is reviewed. The coins stay in escrow.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT RAISED', subtitle: e.message });
    },
  });
}
