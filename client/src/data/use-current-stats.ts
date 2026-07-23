import { useBodyweightLog, useLatestBodyfatMid, useLiftBests, useProfile } from './hooks';
import { currentBodyweightKg } from '@/domain/bodyweight-current';
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
  // Perf (2026-07-23): the five bestE1rmFor scans over the 2,500-row log
  // moved into useLiftBests' TanStack select — computed once per data
  // change, not once per render of every consumer (Home re-rendered this
  // on every unrelated state change).
  const lifts = useLiftBests();
  const bf = useLatestBodyfatMid();

  // A6: the one bodyweight chain (this file already had the canonical order).
  // loggedBw (log-only) survives for the provenance label below.
  const loggedBw = currentBodyweightKg(bodyweights.data, null);
  const bodyweightKg = loggedBw ?? currentBodyweightKg([], profile.data?.bodyweight_kg);

  const heightRaw = pyFloat(profile.data?.height_cm) ?? null;
  const heightCm = heightRaw && heightRaw > 0 ? heightRaw : null;

  const lift = (derived: number, snapshot: unknown): [number | null, 'log' | 'profile' | 'none'] => {
    if (derived > 0) return [derived, 'log'];
    const snap = pyFloat(snapshot) ?? 0;
    return snap > 0 ? [snap, 'profile'] : [null, 'none'];
  };
  const [benchE1rm, benchSrc] = lift(lifts.data?.bench ?? 0, profile.data?.bench_e1rm);
  const [squatE1rm, squatSrc] = lift(lifts.data?.squat ?? 0, profile.data?.squat_e1rm);
  const [deadliftE1rm, dlSrc] = lift(lifts.data?.deadlift ?? 0, profile.data?.deadlift_e1rm);

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
