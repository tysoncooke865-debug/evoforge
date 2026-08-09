import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';

import {
  DEFAULT_CALLOUT_CONFIG,
  calloutsAvailable,
  countedSetsEver,
  isLive,
  type CalloutConfig,
  type CalloutRow,
} from '@/domain/callouts';
import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { useCalloutsEnabled } from './callout-prefs';
import { useWorkoutLog } from './hooks';
import { invalidateTable } from './keys';
import { useFriends } from './social';
import { supabase } from './supabase';

/**
 * LIVE WORKOUT CALL OUTS — the client's side of migrations 150–153.
 *
 * Every mutation here is one RPC. There is no direct table write anywhere in
 * this file, because `workout_callouts` has exactly one RLS policy and it is a
 * SELECT: creating, accepting, verifying and refunding are all SECURITY DEFINER
 * functions, so the client's job is to ask and to re-read.
 *
 * NO ODDS ARE SENT. 163 dropped the columns and v5 §4 bans the concept, so what
 * the create call, because only the athlete's client can read the athlete's log.
 * The server clamps whatever arrives. See 150's header for why that is safe.
 */

const KEY = 'workout_callouts';
const CONFIG_KEY = 'callout_config';

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** Everything a call out can change, in one place — the duel's rule, and for
 *  the same reason: invalidating a subset is how a pot ends up disagreeing with
 *  a wallet on the same screen. */
export function refreshCallouts(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null
) {
  void queryClient.invalidateQueries({ queryKey: [KEY, userId] });
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
  invalidateTable(queryClient, 'coin_events');
  void queryClient.invalidateQueries({ queryKey: ['notif_unread', userId] });
}

/** Postgres speaks in constraint names; athletes do not. */
function humanise(message: string): string {
  const m = message.replace(/^[a-z_]+:\s*/i, '').trim();
  if (/workout_callouts_one_live|duplicate key/i.test(message)) {
    return 'You already have a call out running.';
  }
  if (/row-level security/i.test(message)) return 'That is not yours to change.';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** A migration that has not been applied yet must read as "nothing here", never
 *  as an error the athlete has to think about. Everything else throws — a
 *  swallowed failure would cache [] and make a live wager disappear. */
function missingBackend(message: string): boolean {
  return /does not exist|schema cache|PGRST202|PGRST205/i.test(message);
}

// ────────────────────────────────────────────────────────────── the knobs

export function useCalloutConfig() {
  return useQuery({
    queryKey: [CONFIG_KEY],
    // The limits move by SQL, not by deploy, but they do not move often.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<CalloutConfig> => {
      const { data, error } = await supabase.rpc('workout_callout_settings');
      if (error || !data) return DEFAULT_CALLOUT_CONFIG;
      const row = Array.isArray(data) ? data[0] : data;
      return { ...DEFAULT_CALLOUT_CONFIG, ...(row as Partial<CalloutConfig>) };
    },
  });
}

// ─────────────────────────────────────────────────────────────── the list

export function useMyCallouts() {
  const userId = useUserId();
  const focused = useIsFocused();
  // THE SETTING GATES EVERYTHING, INCLUDING THE READ. An athlete who switched
  // call outs off pays nothing at all for the feature — no RPC on mount, no
  // poll, no channel. That is what "off" has to mean on a workout logger.
  const { enabled } = useCalloutsEnabled();
  const query = useQuery({
    queryKey: [KEY, userId],
    enabled: userId !== null && enabled,
    /**
     * THE SAME LESSON THE DUEL PAID FOR, one level faster.
     *
     * Everything on a call out card can be changed by somebody else, and the
     * whole feature is about a thirty-second exchange — so the global
     * `staleTime: 45_000` is not merely stale here, it is the difference
     * between "you're on" and "nothing happened". Realtime (below) carries the
     * change in a blink; this poll is what guarantees it arrives at all, and it
     * is FOCUS-GATED so a preloaded tab never fires it.
     */
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: focused ? 8_000 : false,
    queryFn: async (): Promise<CalloutRow[]> => {
      const { data, error } = await supabase.rpc('my_workout_callouts');
      if (error) {
        if (missingBackend(error.message)) return [];
        throw error;
      }
      return (data ?? []) as CalloutRow[];
    },
  });

  // Nothing live? Stop asking. A pure logger who never touches the feature
  // pays for one read per mount and no polling at all.
  const anyLive = (query.data ?? []).some((c) => isLive(c.status));
  return { ...query, anyLive };
}

/**
 * IS THE FEATURE REVEALED FOR THIS ATHLETE?
 *
 * One place, so Train and the workout page can never disagree about whether the
 * affordance exists. Reads only caches every one of those screens already
 * holds — the log, the friend list and the profile — so asking costs nothing.
 *
 * THIS GATES CREATING, NOT ANSWERING. The reveal exists because "will you hit 8
 * at 90" is meaningless about somebody the app has never seen lift — that is a
 * reason not to show them the ◉, and NOT a reason to hide an offer a friend has
 * already staked coins on. Receiving is gated by the SETTING alone, which is
 * also what `callout_create` checks server-side. Conflating the two would leave
 * a caller's coins in an offer their friend could never see.
 */
export function useCalloutsAvailable(): boolean {
  const pref = useCalloutsEnabled();
  const workouts = useWorkoutLog();
  const friends = useFriends();
  return calloutsAvailable({
    enabled: pref.enabled,
    countedSetsEver: countedSetsEver(workouts.data ?? []),
    friendCount: (friends.data ?? []).length,
  });
}

/**
 * REALTIME — the accelerator, never the guarantee.
 *
 * Two filters on one channel, because postgres_changes filters a single column
 * and an athlete is on one side or the other. RLS decides delivery, so a client
 * only ever receives rows it could already read.
 *
 * The callback INVALIDATES and never applies the payload. That is what makes a
 * duplicate delivery a duplicate refetch instead of a duplicate chip, and what
 * makes a reconnect self-healing: the database is the event log.
 */
export function useCalloutRealtime(): void {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const { enabled } = useCalloutsEnabled();
  useEffect(() => {
    if (!userId || !enabled) return;
    const topic = `callouts:${userId}`;

    /**
     * MOUNT ONCE — AND REFUSE TO MOUNT TWICE.
     *
     * This crashed production seven times in twelve minutes, and the route
     * error boundary's own analytics named it exactly:
     *
     *   "cannot add `postgres_changes` callbacks for realtime:callouts::id
     *    after `subscribe()`"
     *
     * supabase-js resolves `channel(topic)` to an EXISTING channel when one
     * with that topic is already open. This hook was mounted on three screens,
     * and a tab screen STAYS MOUNTED once visited — so the second screen got
     * the live channel back and calling `.on()` on it threw, taking the whole
     * route down mid tab-change.
     *
     * The real fix is the one `useOnlinePresence` documents: mount it ONCE, at
     * the authenticated root. This guard is the second line, so that re-adding
     * the hook to a screen later is a no-op instead of a crash — and it asks
     * the exact question the error asks.
     */
    if (supabase.getChannels().some((c) => c.topic === `realtime:${topic}`)) return;

    const bump = () => refreshCallouts(queryClient, userId);
    const channel = supabase
      .channel(topic)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'workout_callouts', filter: `athlete_id=eq.${userId}` },
        bump)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'workout_callouts', filter: `opponent_id=eq.${userId}` },
        bump)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, enabled, queryClient]);
}

// ─────────────────────────────────────────────────────────── the actions

export interface CreateCalloutInput {
  opponentId: string;
  workoutDate: string;
  workout: string;
  exercise: string;
  setNo: number;
  targetReps: number;
  targetLoadMode: string;
  targetWeightKg: number | null;
  targetLabel: string;
  stake: number;
  /** Analytics only: how long the tray was open before SEND, and how many
   *  calls this athlete has made in this workout. The second one is how we
   *  learn whether people run it back. */
  msToSend?: number;
  sessionSeq?: number;
}

export function useCreateCallout() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: CreateCalloutInput): Promise<string> => {
      const { data, error } = await supabase.rpc('callout_create', {
        p_opponent: input.opponentId,
        p_workout_date: input.workoutDate,
        p_workout: input.workout,
        p_exercise: input.exercise,
        p_set_no: input.setNo,
        p_target_reps: input.targetReps,
        p_target_load_mode: input.targetLoadMode,
        p_target_weight_kg: input.targetWeightKg,
        p_target_label: input.targetLabel,
        p_stake: input.stake,
      });
      if (error) throw new Error(humanise(error.message));
      return String((data as { callout_id: string }).callout_id);
    },
    onSuccess: (_id, input) => {
      refreshCallouts(queryClient, userId);
      track('callout_sent', {
        stake: input.stake,
        set_no: input.setNo,
        ms_to_send: input.msToSend ?? null,
        session_seq: input.sessionSeq ?? 1,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'CALL OUT NOT SENT', subtitle: e.message });
    },
  });
}

export function useRespondCallout() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean; msToAccept?: number }) => {
      const { data, error } = await supabase.rpc('callout_respond', { p_callout: id, p_accept: accept });
      if (error) throw new Error(humanise(error.message));
      return data as { status: string; already?: boolean; pot?: number };
    },
    onSuccess: (result, { accept, msToAccept }) => {
      refreshCallouts(queryClient, userId);
      track(accept ? 'callout_accepted' : 'callout_declined', {
        already: Boolean(result.already),
        ms_to_accept: msToAccept ?? null,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT ANSWER', subtitle: e.message });
    },
  });
}

export function useCancelCallout() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('callout_cancel', { p_callout: id });
      if (error) throw new Error(humanise(error.message));
    },
    onSuccess: () => refreshCallouts(queryClient, userId),
    onError: () => undefined,
  });
}

/** Asking to call off an ACCEPTED call. One side is a request; both is a
 *  refund. The copy has to say which happened, or a request reads as a bug. */
export function useCallOffCallout() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('callout_call_off', { p_callout: id });
      if (error) throw new Error(humanise(error.message));
      return data as { status: string; awaiting_other_side?: boolean; refunded?: number };
    },
    onSuccess: (result) => {
      refreshCallouts(queryClient, userId);
      useToastStore.getState().push(
        result.awaiting_other_side
          ? { kind: 'info', title: 'ASKED TO CALL IT OFF', subtitle: 'They have to agree — the pot stays put until then.' }
          : { kind: 'info', title: 'CALLED OFF', subtitle: 'Both stakes returned.' }
      );
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT CALL IT OFF', subtitle: e.message });
    },
  });
}

export function useVerifyCallout() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({ id, verdict, reason }: { id: string; verdict: 'verify' | 'dispute'; reason?: string }) => {
      const { data, error } = await supabase.rpc('callout_verify', {
        p_callout: id, p_verdict: verdict, p_reason: reason ?? null,
      });
      if (error) throw new Error(humanise(error.message));
      return data as { status: string; result?: string; pot?: number; already?: boolean };
    },
    onSuccess: (result, { verdict }) => {
      refreshCallouts(queryClient, userId);
      track(verdict === 'verify' ? 'callout_verified' : 'callout_disputed', {
        result: result.result ?? null,
        already: Boolean(result.already),
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT VERIFY', subtitle: e.message });
    },
  });
}

/**
 * THE CLOCK, run once per mount by whoever opens a surface that shows call outs.
 *
 * There is no scheduler in this product (the duel hub does the same thing), and
 * this is deliberately NOT called from the workout page on every mount: a pure
 * logger must not pay an RPC for a feature they never use. It runs where call
 * outs are actually listed, and inside create/respond/verify the server keeps
 * itself tidy anyway.
 */
export function useCalloutSweep() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('callout_sweep');
      if (error) {
        if (missingBackend(error.message)) return null;
        throw error;
      }
      return data as { expired: number; refunded: number; repaired: number } | null;
    },
    onSuccess: (result) => {
      if (!result) return;
      if (result.expired > 0 || result.refunded > 0 || result.repaired > 0) {
        refreshCallouts(queryClient, userId);
      }
      if (result.refunded > 0 || result.repaired > 0) {
        useToastStore.getState().push({
          kind: 'info',
          title: 'STAKES RETURNED',
          subtitle: 'A call out ran out of time. Nobody won it.',
        });
      }
    },
    // A failed sweep is invisible on purpose: it is housekeeping, and the
    // athlete did nothing just now that deserves an error.
    onError: () => undefined,
  });
}

/** Run the sweep exactly once per mount of a surface that lists call outs. */
export function useCalloutSweepOnce(enabled = true): void {
  const sweep = useCalloutSweep();
  const userId = useUserId();
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current || !userId || !enabled) return;
    swept.current = true;
    sweep.mutate();
    // `sweep` is a fresh object each render; the ref is what makes this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled]);
}
