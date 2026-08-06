/**
 * HAS THIS ATHLETE SEEN THE FIRST-RUN TOUR, AND MAY IT RUN RIGHT NOW?
 *
 * Two questions, deliberately separate, because they failed separately.
 *
 * SEEN is per ATHLETE (migration 137). It used to live only in AsyncStorage —
 * localStorage on web — which is per DEVICE: a second browser, a new phone or
 * a reinstall replayed the tour, and two athletes sharing a device shared one
 * flag. The profile column is the truth and is write-once server-side, so the
 * tour can never re-arm. AsyncStorage stays as a local fast path so the
 * overlay does not flash while the profile query is in flight.
 *
 * MAY RUN is about the athlete's CURRENT state, read from persisted data
 * rather than component state:
 *
 *   - it waits for a COMPLETED workout. The previous gate was "has a logged
 *     training day", which is true the moment the first set lands — so the
 *     tour appeared over a workout in progress, which is the whole complaint.
 *   - it never runs while a workout is under way, even a later one.
 *   - it only runs on Home, so it can never cover the logger, the finish
 *     summary or Train.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { useProfile, useWorkoutLog } from './hooks';
import { useWorkoutSessions } from './sessions';
import { supabase } from './supabase';
import { startedWorkoutToday } from '@/domain/today-session';
import { todayIso } from '@/domain/today';

export type TourEnding = 'completed' | 'skipped';

export interface TourGate {
  /** Everything needed to decide has loaded. */
  ready: boolean;
  /** The athlete has finished or skipped it — never show it again. */
  seen: boolean;
  /** At least one workout has been COMPLETED. */
  hasCompletedWorkout: boolean;
  /** A workout is under way right now (logged sets today, not yet finished). */
  workoutInProgress: boolean;
  /** The whole decision: may the tour render at all? */
  mayShow: boolean;
}

export function useTourGate(): TourGate {
  const profile = useProfile();
  const sessions = useWorkoutSessions();
  const workouts = useWorkoutLog();

  const ready = !profile.isPending && !sessions.isPending && !workouts.isPending;
  const seen = profile.data?.tour_completed_at != null;

  const finished = sessions.data ?? [];
  const hasCompletedWorkout = finished.length > 0;

  // Server truth: a workout with sets logged today and no finish marker for
  // it. Survives a refresh, a second device and a cleared session store —
  // the three ways a component-state flag loses track of a live session.
  const today = todayIso();
  const started = startedWorkoutToday(workouts.data ?? [], today);
  const workoutInProgress =
    started !== null && !finished.some((m) => m.date === today && m.workout === started);

  return {
    ready,
    seen,
    hasCompletedWorkout,
    workoutInProgress,
    mayShow: ready && !seen && hasCompletedWorkout && !workoutInProgress,
  };
}

/**
 * Record the ending. Idempotent by construction: migration 137's trigger
 * keeps the FIRST answer, so a double tap, a retry or a second device cannot
 * rewrite it — and cannot clear it, which is what "the tour came back" would
 * have been.
 */
export function useMarkTourSeen() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (ending: TourEnding) => {
      if (!userId) return;
      const { error } = await supabase
        .from('profile')
        .update({ tour_completed_at: new Date().toISOString(), tour_state: ending })
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    // Never surfaced: the local flag has already hidden the overlay, and a
    // failed write costs the athlete one extra dismissal at worst. Throwing a
    // toast at somebody for closing a tutorial would be absurd.
    onError: () => undefined,
  });
}
