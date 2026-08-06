/**
 * "HAVE THEY STARTED THEIR FIRST WORKOUT?" — a record, not an inference.
 *
 * Every signal the client had was derived from logged SETS, and a workout
 * that has been opened but not yet logged has none — so Train kept offering
 * START FIRST WORKOUT to somebody already looking at it. Migration 138 stores
 * the answer on the profile, which is what makes it survive a refresh, a
 * sign-out and a second device.
 *
 * The write is fire-and-forget and write-once server-side: a second tap, a
 * retry or a race all converge on the first record, so nothing here has to be
 * careful about ordering.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { useProfile, useWorkoutLog, useWorkoutIndex } from './hooks';
import { useWorkoutSessions } from './sessions';
import { supabase } from './supabase';
import { firstWorkoutCta, startedWorkoutToday, type FirstWorkoutCta } from '@/domain/today-session';
import { todayIso } from '@/domain/today';

export function useMarkFirstWorkoutStarted() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: { workout: string; date: string }) => {
      if (!userId) return;
      const { error } = await supabase
        .from('profile')
        .update({
          first_workout_at: new Date().toISOString(),
          first_workout_name: input.workout,
          first_workout_date: input.date,
        })
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    // Never surfaced. A failed stamp costs one stale CTA label, and throwing a
    // toast at somebody who just tapped START would be worse than the label.
    onError: () => undefined,
  });
}

export interface FirstWorkoutState {
  cta: FirstWorkoutCta;
  /** The workout the CTA opens — the recorded one when there is one. */
  workout: string | null;
  ready: boolean;
}

/** The CTA state, assembled from rows every surface already has loaded. */
export function useFirstWorkout(starterWorkout: string | null): FirstWorkoutState {
  const profile = useProfile();
  const sessions = useWorkoutSessions();
  const workouts = useWorkoutLog();
  const index = useWorkoutIndex();

  const today = todayIso();
  const finished = sessions.data ?? [];
  const recorded = profile.data?.first_workout_name ?? null;

  const cta = firstWorkoutCta({
    completedAnyWorkout: finished.length > 0,
    completedToday: finished.some((m) => m.date === today),
    startedFirstWorkout: profile.data?.first_workout_at != null,
    setsLoggedToday: startedWorkoutToday(workouts.data ?? [], today) !== null,
    starterWorkout,
  });

  return {
    cta,
    // Resume the workout that was actually recorded; fall back to the starter
    // so a pre-138 athlete still resumes something real.
    workout: cta === 'resume' ? (recorded ?? starterWorkout) : starterWorkout,
    ready: !profile.isPending && !sessions.isPending && !workouts.isPending && !index.isPending,
  };
}
