import type { ProfileRow } from '@/data/hooks';
import type { OriginStatus } from '@/data/origin';
import type { ForgeRow } from '@/data/progression/use-forge';
import type { PhysiqueValues } from '@/domain/avatar-stats-calc';

/**
 * The lab athlete's identity rows: a believable three-years-in cutter so
 * every derived surface (rank, avatar stats, forge level) paints something
 * real. Static values are fine HERE — only dates must be computed, and the
 * identity rows carry none that gate behaviour (created_at just needs to be
 * "the past").
 */

export const LAB_PROFILE: ProfileRow = {
  id: 'lab-profile-1',
  height_cm: 180,
  bodyweight_kg: 82,
  bench_e1rm: 110,
  squat_e1rm: 140,
  training_years: 3,
  physique_score: 6.6,
  leanness_score: 6.2,
  base_level: 3,
  created_at: '2026-01-05T09:00:00',
  sex: 'male',
  deadlift_e1rm: 180,
  nutrition_phase: 'cut',
  origin_path: 'aesthetic',
  onboarding_flow_version: 2,
};

export const LAB_FORGE: ForgeRow = {
  forge_level: 7,
  lifetime_xp: 3400,
  weekly_target: 4,
  legacy_xp: null,
  migration_version: 'v1',
};

export const LAB_ORIGIN: OriginStatus = {
  origin_path: 'aesthetic',
  active_path: 'aesthetic',
  active_stage: 2,
  migration_status: 'complete',
};

export const LAB_PHYSIQUE: PhysiqueValues = {
  physique_score: 6.6,
  leanness_score: 6.2,
  symmetry_score: 6.8,
  muscularity_score: 6.4,
};

/** Latest-first would rot the charts; these are oldest → newest, matching
 *  the ascending contract useBodyfatSeries keeps. */
export const LAB_BODYFAT_SERIES: number[] = [22, 21.2, 20.1, 19.4];

export const LAB_COIN_TOTAL = 145;
