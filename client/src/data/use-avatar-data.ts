import { currentBodyweightKg } from '@/domain/bodyweight-current';
import {
  useBodyweightLog,
  useEarliestBodyfat,
  useCardioLog,
  useLatestBodyfatMid,
  useLedgerXp,
  usePhysiqueRatings,
  useProfile,
  useWorkoutLog,
} from './hooks';
import {
  calculateAvatarStats,
  FEMALE_CALIBRATION,
  MALE_CALIBRATION,
  type AvatarStats,
} from '@/domain/avatar-stats-calc';
import { resolveBranchV2, type BranchV2 } from '@/domain/branches-v2';
import { pyFloat } from '@/domain/py';
import { workoutSummary, type WorkoutSummary } from '@/domain/summary';

export interface AvatarData {
  /** True once every underlying query has resolved — level/XP are REAL, not
   *  the pre-load defaults. Celebration detectors must wait for this. */
  ready: boolean;
  /** The five-class resolver (extremes first, pinned core fallback). */
  branchV2: BranchV2;
  sex: 'male' | 'female';
  earliestBf: number | null;
  nutritionPhase: string | null;
  summary: WorkoutSummary;
  stats: AvatarStats;
  bfMid: number | null;
  cardioDistanceKm: number;
}

/**
 * One assembly of the whole character: every hook, then the two pure cores
 * (workoutSummary + calculateAvatarStats) over their rows. Home and Avatar
 * both consume this so the two screens can never disagree about who the
 * athlete is -- the Streamlit app computes it once per render for the same
 * reason (verify_perf pins it there; here the Query cache dedupes the reads).
 */
export function useAvatarData(): AvatarData {
  const profile = useProfile();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const bodyweights = useBodyweightLog();
  const bfMid = useLatestBodyfatMid();
  const earliestBf = useEarliestBodyfat();
  const physique = usePhysiqueRatings();
  const ledger = useLedgerXp();

  const baseLevel = profile.data?.base_level ?? 1;
  const summary = workoutSummary(
    workouts.data ?? [],
    cardio.data ?? [],
    ledger.data ?? null,
    baseLevel
  );

  // A6: the one bodyweight chain. Previously log-only; the profile weight
  // now backs an empty log (the athlete DID tell us at onboarding), and the
  // calc's Python 77kg default remains the true last resort.
  const latestBodyweight = currentBodyweightKg(bodyweights.data, profile.data?.bodyweight_kg);

  const cardioDistanceKm = (cardio.data ?? []).reduce(
    (acc, r) => acc + (pyFloat((r as Record<string, unknown>).distance_km) ?? 0),
    0
  );

  // Sex calibration: equal RELATIVE performance earns equal points — female
  // athletes grade against female strength/leanness/frame standards, not
  // male ones (see SexCalibration in avatar-stats-calc.ts).
  const sexValue = profile.data?.sex === 'female' ? ('female' as const) : ('male' as const);
  const stats = calculateAvatarStats(
    {
      workoutRows: workouts.data ?? [],
      level: summary.level,
      latestBodyweight,
      bfMid: bfMid.data ?? null,
      physique: physique.data ?? {
        physique_score: null,
        leanness_score: null,
        symmetry_score: null,
        muscularity_score: null,
      },
      cardioMinutes: summary.cardioMinutes,
      cardioDistanceKm,
      profileDeadliftE1rm: pyFloat(profile.data?.deadlift_e1rm) ?? null,
    },
    sexValue === 'female' ? FEMALE_CALIBRATION : MALE_CALIBRATION
  );

  const ready =
    !profile.isPending &&
    !workouts.isPending &&
    !cardio.isPending &&
    !ledger.isPending;

  const branchV2 = resolveBranchV2(
    {
      strength: stats.strengthScore,
      size: stats.sizeScore,
      leanness: stats.leannessScore,
      conditioning: stats.conditioningScore,
      aesthetic: stats.aestheticScore,
    },
    {
      nutritionPhase: profile.data?.nutrition_phase ?? null,
      earliestBf: earliestBf.data ?? null,
    }
  );
  return {
    ready,
    branchV2,
    sex: sexValue,
    summary,
    stats,
    bfMid: bfMid.data ?? null,
    earliestBf: earliestBf.data ?? null,
    nutritionPhase: profile.data?.nutrition_phase ?? null,
    cardioDistanceKm,
  };
}
