import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SessionMarker } from '@/domain/week-status';
import { useSharePromptStore } from '@/state/share-prompt-store';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { useClaimCoin } from './coins';
import { dequeueFinish, enqueueFinish } from './finish-queue';
import { supabase } from './supabase';

/**
 * The finish marker (migration 017) — the fix for "FINISH WORKOUT finishes
 * nothing".
 *
 * Insert = the athlete said they were done. Delete = REOPEN (a fat-fingered
 * FINISH must be recoverable; there is no update, because there is no such
 * thing as half-finishing).
 *
 * Idempotent: finishing twice is the same as finishing once — the unique index
 * says so, and a duplicate is a success, not an error. Two taps on a slow
 * network must not produce a scary toast about a workout that IS finished.
 *
 * Reads degrade to [] while the table is absent: status then derives from the
 * log exactly as it did before the feature, and FINISH surfaces its error.
 */

export function useWorkoutSessions() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['workout_sessions', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<SessionMarker[]> => {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('id,date,workout,finished_at');
      if (error) {
        // ONLY "the table isn't there yet" degrades to empty — that genuinely
        // means "no markers exist". EVERYTHING ELSE THROWS.
        //
        // Swallowing every failure as an empty SUCCESS was catastrophic: React
        // Query cached [], the optimistic finish marker was deleted by the
        // refetch that onSettled fires, and the whole week's COMPLETED/🔒 state
        // evaporated on any transient blip — including the very offline finish
        // this feature exists to protect. A throw keeps the last good data.
        if (/does not exist|schema cache|PGRST205/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as SessionMarker[];
    },
  });
}

/**
 * TRAIN_PAGE_V2 — finishing is now OPTIMISTIC and DURABLE.
 *
 * Optimistic: the marker lands in the cache before the network is asked, so the
 * bar goes green and the workout locks on the frame the athlete tapped. A
 * workout ends when they say it ends, not when a server agrees.
 *
 * Durable: a failed insert goes into the persistent finish queue and retries on
 * boot / reconnect / 30s, exactly like a set. It used to be fire-and-forget —
 * offline, the decision evaporated while the SETS survived, which is nonsense:
 * a set cannot outlive the workout it belongs to.
 *
 * TEMP-ID RECONCILIATION: the optimistic row carries a `pending:` id, because it
 * has no server id yet. REOPEN must never try to DELETE BY that id — it does not
 * exist server-side. useReopenWorkout deletes by (date, workout) when it sees
 * one, which is the marker's real identity anyway (017's unique index).
 */
export const PENDING_PREFIX = 'pending:';

export function useFinishWorkout() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const claimCoins = useClaimCoin();
  const key = ['workout_sessions', userId];

  return useMutation({
    mutationFn: async (input: { date: string; workout: string }) => {
      const { error } = await supabase
        .from('workout_sessions')
        .insert({ date: input.date, workout: input.workout });
      // Already finished IS finished. The unique index is the authority.
      if (error && !/duplicate|unique|already exists/i.test(error.message)) throw error;
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<SessionMarker[]>(key) ?? [];
      if (!prev.some((m) => m.date === input.date && m.workout === input.workout)) {
        queryClient.setQueryData<SessionMarker[]>(key, [
          ...prev,
          { id: `${PENDING_PREFIX}${input.date}|${input.workout}`, ...input },
        ]);
      }
      return { prev };
    },

    onError: async (e: Error, input, ctx) => {
      // The network is not the athlete's problem. Keep the optimistic marker,
      // queue the write, and say so honestly.
      void ctx; // the rollback is deliberately NOT taken — see below
      await enqueueFinish(input.date, input.workout);
      useToastStore.getState().push({
        kind: 'info',
        title: 'FINISH SAVED',
        subtitle: 'Offline — it will sync.',
      });
    },

    onSuccess: (_d, input) => {
      claimCoins.mutate({ kind: 'workout_complete', sourceId: input.date });
      // Offer to share the finished workout (no-op if "don't ask again" is set;
      // the overlay gates on the social flag). Never auto-publishes.
      useSharePromptStore.getState().offer({ workout: input.workout, date: input.date });
    },

    onSettled: () => {
      // A refetch replaces the pending row with the real one. If we are offline
      // the refetch fails, the optimistic row stays, and the queue keeps trying.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useReopenWorkout() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (marker: SessionMarker) => {
      // A PENDING marker has no server id — deleting by it would delete nothing
      // and leave the workout finished forever. Its real identity is
      // (date, workout), which is what 017's unique index keys on, so delete by
      // that. (Also correct for a real row; the id is just faster.)
      const q = supabase.from('workout_sessions').delete();
      const { error } = marker.id.startsWith(PENDING_PREFIX)
        ? await q.eq('date', marker.date).eq('workout', marker.workout)
        : await q.eq('id', marker.id);
      if (error) throw error;
    },
    onMutate: async (marker) => {
      // A finish queued while offline must die with the REOPEN that undoes it.
      // Otherwise the queue flushes on reconnect and re-finishes the workout
      // the athlete just reopened — mid-set, with no action of theirs.
      await dequeueFinish(marker.date, marker.workout);
      await queryClient.cancelQueries({ queryKey: ['workout_sessions', userId] });
      const prev = queryClient.getQueryData<SessionMarker[]>(['workout_sessions', userId]) ?? [];
      queryClient.setQueryData<SessionMarker[]>(
        ['workout_sessions', userId],
        prev.filter((m) => !(m.date === marker.date && m.workout === marker.workout))
      );
      return { prev };
    },
    onSuccess: () => {
      useToastStore.getState().push({
        kind: 'info',
        title: 'REOPENED',
        subtitle: 'Log away — the workout is unlocked.',
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workout_sessions', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT REOPENED', subtitle: e.message });
    },
  });
}
