import type { QueryClient } from '@tanstack/react-query';

// Relative runtime imports on purpose: the vitest suite drives seedLabCache
// and the test runner resolves no '@/' alias (same rule as domain/ modules).
import { activityXp } from '../../domain/xp';
import { todayIso } from '../../domain/today';

import { LAB_USER_ID } from '../lab-user';
import {
  LAB_BODYFAT_SERIES,
  LAB_COIN_TOTAL,
  LAB_FORGE,
  LAB_ORIGIN,
  LAB_PHYSIQUE,
  LAB_PROFILE,
} from './athlete';
import {
  LAB_EXERCISE_PREFS,
  LAB_PLAN_SOURCE_PREF,
  LAB_USER_EXERCISES,
  LAB_USER_PLANS,
  labRoutines,
} from './plans';
import {
  labBodyweightLog,
  labCardioLog,
  labSchedule,
  labSessionMarkers,
  labWorkoutLog,
} from './training';

/**
 * Seed the mock QueryClient at every key the Train and Workout screens read.
 * Keys mirror the hooks exactly: [name, LAB_USER_ID] — the fake session makes
 * every hook compute userId = LAB_USER_ID, so they hit these entries and
 * (staleTime: Infinity) never fire a queryFn. An UNSEEDED key still fetches
 * through the real Supabase client: signed out that is an RLS-empty read,
 * which is the honest degraded state, not a crash.
 *
 * KEEP THIS LIST IN SYNC with LAB_SEEDED_KEYS below — the registry test
 * pins that every required key gets seeded.
 */
export function seedLabCache(queryClient: QueryClient): void {
  const today = todayIso();

  const workoutLog = labWorkoutLog(today);
  const cardioLog = labCardioLog(today);
  const cardioMinutes = cardioLog.reduce((acc, r) => acc + Number(r.minutes ?? 0), 0);

  const seed = (name: string, data: unknown) =>
    queryClient.setQueryData([name, LAB_USER_ID], data);

  seed('profile', LAB_PROFILE);
  seed('workout_log', workoutLog);
  seed('cardio_log', cardioLog);
  seed('bodyweight_log', labBodyweightLog(today));
  seed('bodyfat_series', LAB_BODYFAT_SERIES);
  seed('physique_ratings', LAB_PHYSIQUE);
  // Ledger == derived, so the drift surfaces read zero (the fixture athlete
  // has no reason to look reconciliation-broken).
  seed('xp_total', activityXp(workoutLog.length, cardioMinutes));
  seed('xp_server_granted', 0);
  seed('user_exercises', LAB_USER_EXERCISES);
  seed('user_exercise_prefs', LAB_EXERCISE_PREFS);
  seed('routines', labRoutines(today));
  seed('workout_schedule', labSchedule(today));
  seed('workout_sessions', labSessionMarkers(today));
  seed('user_plans', LAB_USER_PLANS);
  seed('plan_source_pref', LAB_PLAN_SOURCE_PREF);
  seed('user_progression', LAB_FORGE);
  seed('coin_total', LAB_COIN_TOTAL);
  seed('origin_status', LAB_ORIGIN);
}

/** The contract the registry test pins: every key here must be planted by
 *  seedLabCache under [name, LAB_USER_ID]. */
export const LAB_SEEDED_KEYS: readonly string[] = [
  'profile',
  'workout_log',
  'cardio_log',
  'bodyweight_log',
  'bodyfat_series',
  'physique_ratings',
  'xp_total',
  'xp_server_granted',
  'user_exercises',
  'user_exercise_prefs',
  'routines',
  'workout_schedule',
  'workout_sessions',
  'user_plans',
  'plan_source_pref',
  'user_progression',
  'coin_total',
  'origin_status',
];
