import {
  useBodyweightLog,
  useCardioLog,
  useLatestBodyfatMid,
  useLedgerXp,
  usePhysiqueRatings,
  useProfile,
  useWorkoutLog,
} from './hooks';
import { calculateAvatarStats, type AvatarStats } from '@/domain/avatar-stats-calc';
import { pyFloat } from '@/domain/py';
import { workoutSummary, type WorkoutSummary } from '@/domain/summary';

export interface AvatarData {
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
  const physique = usePhysiqueRatings();
  const ledger = useLedgerXp();

  const baseLevel = profile.data?.base_level ?? 1;
  const summary = workoutSummary(
    workouts.data ?? [],
    cardio.data ?? [],
    ledger.data ?? null,
    baseLevel
  );

  // latest_bodyweight_value(): last positive reading, else null (the calc
  // applies Python's 77kg default itself).
  const positiveBw = (bodyweights.data ?? [])
    .map((r) => pyFloat(r.bodyweight) ?? 0)
    .filter((v) => v > 0);
  const latestBodyweight = positiveBw.length > 0 ? positiveBw[positiveBw.length - 1] : null;

  const cardioDistanceKm = (cardio.data ?? []).reduce(
    (acc, r) => acc + (pyFloat((r as Record<string, unknown>).distance_km) ?? 0),
    0
  );

  const stats = calculateAvatarStats({
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
  });

  return { summary, stats, bfMid: bfMid.data ?? null, cardioDistanceKm };
}
