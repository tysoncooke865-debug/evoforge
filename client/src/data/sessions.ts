import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SessionMarker } from '@/domain/week-status';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { useClaimCoin } from './coins';
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
      try {
        const { data, error } = await supabase
          .from('workout_sessions')
          .select('id,date,workout,finished_at');
        if (error) return [];
        return (data ?? []) as SessionMarker[];
      } catch {
        return [];
      }
    },
  });
}

export function useFinishWorkout() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const claimCoins = useClaimCoin();

  return useMutation({
    mutationFn: async (input: { date: string; workout: string }) => {
      const { error } = await supabase
        .from('workout_sessions')
        .insert({ date: input.date, workout: input.workout });
      // Already finished IS finished. The unique index is the authority.
      if (error && !/duplicate|unique|already exists/i.test(error.message)) throw error;
    },
    onSuccess: (_d, input) => {
      void queryClient.invalidateQueries({ queryKey: ['workout_sessions', userId] });
      // The coin claim was already fired on derived-complete; firing it here too
      // is safe — the 013 guard re-proves eligibility server-side (10-valid-set
      // floor) and the unique index absorbs the repeat. The client never decides.
      claimCoins.mutate({ kind: 'workout_complete', sourceId: input.date });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT FINISHED',
        subtitle: e.message,
      });
    },
  });
}

export function useReopenWorkout() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workout_sessions', userId] });
      useToastStore.getState().push({
        kind: 'info',
        title: 'REOPENED',
        subtitle: 'Log away — the workout is unlocked.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT REOPENED', subtitle: e.message });
    },
  });
}
