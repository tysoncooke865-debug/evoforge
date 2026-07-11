import { useBodyweightLog, useLatestBodyfatMid, useProfile, useWorkoutLog } from './hooks';
import { bestE1rmFor } from '@/domain/avatar-stats-calc';
import { pyFloat } from '@/domain/py';

/**
 * THE single read seam for the athlete's current body stats
 * (IMPROVEMENT_PLAN #1). Values are RAW AND NULLABLE — this hook never
 * defaults, because the pinned avatar-stats calc applies its own 77 kg
 * fallback internally and must keep receiving byte-identical inputs
 * (feed it a pre-defaulted value and the golden fixtures break). Screens
 * that need a fallback apply their own, explicitly, at the call site.
 *
 * Precedence per field (the `sources` object says which won):
 *   bodyweight: latest positive bodyweight_log row → profile onboarding
 *               snapshot (frozen — base_level was derived from it) → null
 *   height:     profile → null
 *   lifts:      best e1RM derived from workout_log → profile snapshot → null
 */
export interface CurrentStats {
  heightCm: number | null;
  bodyweightKg: number | null;
  benchE1rm: number | null;
  squatE1rm: number | null;
  deadliftE1rm: number | null;
  bfMid: number | null;
  sex: 'male' | 'female';
  sources: Record<'bodyweight' | 'height' | 'bench' | 'squat' | 'deadlift', 'log' | 'profile' | 'none'>;
}

export function useCurrentStats(): CurrentStats {
  const profile = useProfile();
  const bodyweights = useBodyweightLog();
  const workouts = useWorkoutLog();
  const bf = useLatestBodyfatMid();

  const positiveBw = (bodyweights.data ?? [])
    .map((r) => pyFloat(r.bodyweight) ?? 0)
    .filter((v) => v > 0);
  const loggedBw = positiveBw.length > 0 ? positiveBw[positiveBw.length - 1] : null;
  const snapshotBw = pyFloat(profile.data?.bodyweight_kg) ?? null;
  const bodyweightKg = loggedBw ?? (snapshotBw && snapshotBw > 0 ? snapshotBw : null);

  const heightRaw = pyFloat(profile.data?.height_cm) ?? null;
  const heightCm = heightRaw && heightRaw > 0 ? heightRaw : null;

  const rows = workouts.data ?? [];
  const lift = (derived: number, snapshot: unknown): [number | null, 'log' | 'profile' | 'none'] => {
    if (derived > 0) return [derived, 'log'];
    const snap = pyFloat(snapshot) ?? 0;
    return snap > 0 ? [snap, 'profile'] : [null, 'none'];
  };
  let bench = bestE1rmFor(rows, 'Barbell Bench Press (Strength)');
  if (bench <= 0) {
    bench = Math.max(bestE1rmFor(rows, 'Barbell Bench Press'), bestE1rmFor(rows, 'Paused Barbell Bench Press'));
  }
  const [benchE1rm, benchSrc] = lift(bench, profile.data?.bench_e1rm);
  const [squatE1rm, squatSrc] = lift(bestE1rmFor(rows, 'Barbell Back Squat'), profile.data?.squat_e1rm);
  const [deadliftE1rm, dlSrc] = lift(bestE1rmFor(rows, 'Barbell Deadlift'), profile.data?.deadlift_e1rm);

  return {
    heightCm,
    bodyweightKg,
    benchE1rm,
    squatE1rm,
    deadliftE1rm,
    bfMid: bf.data ?? null,
    sex: profile.data?.sex === 'female' ? 'female' : 'male',
    sources: {
      bodyweight: loggedBw !== null ? 'log' : bodyweightKg !== null ? 'profile' : 'none',
      height: heightCm !== null ? 'profile' : 'none',
      bench: benchSrc,
      squat: squatSrc,
      deadlift: dlSrc,
    },
  };
}
