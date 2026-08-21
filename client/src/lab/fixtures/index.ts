import type { QueryClient } from '@tanstack/react-query';

// Relative runtime imports on purpose: the vitest suite drives seedLabCache
// and the test runner resolves no '@/' alias (same rule as domain/ modules).
import { activityXp } from '../../domain/xp';
import { addDaysIso, todayIso } from '../../domain/today';

import { LAB_USER_ID } from '../lab-user';
import {
  LAB_BODYFAT_SERIES,
  LAB_CHARACTER_UNLOCKS,
  LAB_COIN_TOTAL,
  LAB_FORGE,
  LAB_ORIGIN,
  LAB_PHYSIQUE,
  LAB_PROFILE,
  LAB_SKIN_UNLOCKS,
  LAB_EVO_SNAPSHOT_LIMIT,
  labEvoRating,
  labEvoSnapshots,
  labPendingEvoEvidence,
} from './athlete';
import {
  LAB_BOARD_METRIC,
  LAB_BOARD_ROWS,
  LAB_LEADERBOARD,
  LAB_PUBLIC_IDENTITY,
} from './social';
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
import {
  LAB_CARDIO_BURN,
  LAB_MEAL_NAMES,
  LAB_SAVED_MEALS,
  labNutritionDates,
  labNutritionLog,
  labNutritionTargets,
} from './nutrition';

/**
 * Seed the mock QueryClient at every key the Home, Train and Workout screens
 * read.
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

  // Reforge fields are computed HERE, not in LAB_PROFILE (static dates rot):
  // with a null anchor and training history, useReforgeDay's lazy anchor
  // write PATCHes profile ON MOUNT — signed out that "succeeds" against zero
  // rows, and its onSuccess invalidation REFETCHES the seeded profile into
  // an RLS-empty null, un-hiding every profile-gated surface (the physique
  // card came back from the dead this way). A stored anchor disarms the
  // write at its own storedAnchor != null gate; the recent last_reforge_at
  // keeps the 28-day cadence quietly mid-cycle.
  seed('profile', {
    ...LAB_PROFILE,
    reforge_anchor_at: `${addDaysIso(today, -64)}T00:00:00Z`,
    last_reforge_at: `${addDaysIso(today, -8)}T09:00:00Z`,
  });
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
  // HOME's own surfaces: the EVO CORE card + radar (evo rating), the hero's
  // display identity (cosmetic unlocks) and the leaderboard teaser.
  seed('evo_rating_current', labEvoRating(today));
  seed('pending_evo_evidence', labPendingEvoEvidence(today));
  seed('user_skin_unlocks', LAB_SKIN_UNLOCKS);
  seed('user_character_unlocks', LAB_CHARACTER_UNLOCKS);
  seed('public_profile', LAB_PUBLIC_IDENTITY);

  // Keys carrying params BEYOND the user id cannot use `seed` — plant them
  // in full, and keep LAB_SEEDED_PARAM_KEYS below in step.
  queryClient.setQueryData(
    ['leaderboard_metric', LAB_USER_ID, LAB_BOARD_METRIC, LAB_BOARD_ROWS],
    LAB_LEADERBOARD
  );
  // The mission card's "+N.N EVO" rate reads the review history with its
  // limit inside the key (useEvoSnapshots(26)).
  queryClient.setQueryData(
    ['evo_rating_snapshots', LAB_USER_ID, LAB_EVO_SNAPSHOT_LIMIT],
    labEvoSnapshots(today)
  );

  // FUEL (2026-08-21): the whole hero hinges on nutrition_targets; the
  // meter, streak and burn line carry today's date INSIDE their keys, so
  // they are planted in full like the leaderboard.
  seed('nutrition_targets', labNutritionTargets(today));
  seed('nutrition_prefs', LAB_MEAL_NAMES);
  seed('saved_meals', LAB_SAVED_MEALS);
  queryClient.setQueryData(['nutrition_log', LAB_USER_ID, today], labNutritionLog(today));
  queryClient.setQueryData(['nutrition_dates', LAB_USER_ID, today], labNutritionDates(today));
  queryClient.setQueryData(['cardio_calories', LAB_USER_ID, today], LAB_CARDIO_BURN);
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
  'evo_rating_current',
  'pending_evo_evidence',
  'user_skin_unlocks',
  'user_character_unlocks',
  'public_profile',
  'nutrition_targets',
  'nutrition_prefs',
  'saved_meals',
];

/** The other half of the contract: keys whose query params sit past the user
 *  id, listed in FULL because [name, LAB_USER_ID] cannot express them. The
 *  leaderboard's metric and row count are part of its key — seeding
 *  ['leaderboard_metric', user] would plant an entry nothing ever reads. */
export const LAB_SEEDED_PARAM_KEYS: readonly (readonly unknown[])[] = [
  ['leaderboard_metric', LAB_USER_ID, LAB_BOARD_METRIC, LAB_BOARD_ROWS],
  ['evo_rating_snapshots', LAB_USER_ID, LAB_EVO_SNAPSHOT_LIMIT],
  // FUEL's day-scoped reads: todayIso() here and in seedLabCache evaluate in
  // the same process, so the keys agree (the training-fixtures midnight
  // caveat applies — a session straddling midnight reseeds on remount).
  ['nutrition_log', LAB_USER_ID, todayIso()],
  ['nutrition_dates', LAB_USER_ID, todayIso()],
  ['cardio_calories', LAB_USER_ID, todayIso()],
];
