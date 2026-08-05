import type { CharacterUnlockRow } from '@/data/characters';
import type { ProfileRow } from '@/data/hooks';
import type { OriginStatus } from '@/data/origin';
import type { ForgeRow } from '@/data/progression/use-forge';
import type { SkinUnlockRow } from '@/data/skins';
import type { PhysiqueValues } from '@/domain/avatar-stats-calc';

// Relative import on purpose: the vitest suite loads these fixtures and the
// test runner resolves no '@/' alias (the domain/ rule). Type-only imports
// above are erased before it ever runs, so they can stay aliased.
import { addDaysIso } from '../../domain/today';

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
  // A v2 athlete: every v3 answer is genuinely absent, and the lab must
  // photograph that state rather than a synthetic one nobody has.
  onboarding_goal: null,
  secondary_goals: null,
  experience_level: null,
  training_route: null,
  training_days_per_week: null,
  session_minutes: null,
  equipment_access: null,
  preferred_days: null,
  photo_prompts_disabled: false,
  physique_baseline_at: null,
  reforge_anchor_at: null,
  last_reforge_at: null,
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

/**
 * The lab athlete's CONFIRMED Evo Rating (migration 024's evo_rating_current).
 * Home's EVO CORE card and the EvoRadar both read this row and both floor the
 * same four pillars, so the wheel and the card agree by construction — seeding
 * it is what lets a Home variant show the real surface instead of the
 * no-row DISCOVER door (whose only button runs a REAL review).
 *
 * The pillars sit near the profile's derived scores so the radar's fallback
 * and its real polygon are not wildly different shapes, and `status` is
 * 'confirmed' because a provisional row prints a tag the baseline shouldn't
 * be pinned to.
 */
export function labEvoRating(todayIso: string): Record<string, unknown> {
  return {
    user_id: 'lab-user',
    raw_rating: 41.6,
    displayed_rating: 42,
    evolution_progress: 60,
    starting_raw_rating: 28.4,
    starting_displayed: 28,
    peak_raw_rating: 41.6,
    peak_displayed: 42,
    lifetime_evolution: 14,
    size_score: 44.2,
    aesthetics_score: 47.8,
    strength_score: 45.1,
    // The limiting pillar, and the one the fixture history explains: the
    // athlete logs six lifting days a week and almost no cardio.
    cardio_score: 29.6,
    size_confidence: 72,
    aesthetics_confidence: 64,
    strength_confidence: 81,
    cardio_confidence: 38,
    overall_confidence: 64,
    confidence_label: 'confirmed',
    descriptor: 'Developed',
    evo_class: 'aesthetic',
    status: 'confirmed',
    limiting_pillar: 'cardio',
    // Computed, never hardcoded — the card renders a day countdown off these
    // (the training-fixture rule: a hardcoded date rots into "review due").
    last_review_at: `${addDaysIso(todayIso, -4)}T08:00:00Z`,
    next_review_at: `${addDaysIso(todayIso, 3)}T08:00:00Z`,
    model_version: 'lab-fixture',
    created_at: `${addDaysIso(todayIso, -60)}T08:00:00Z`,
    updated_at: `${addDaysIso(todayIso, -4)}T08:00:00Z`,
  };
}

/** One pending projection, so the EVO CORE card's "· N pending" tail renders.
 *  Columns match usePendingEvoEvidence's select list exactly. */
export function labPendingEvoEvidence(todayIso: string): Record<string, unknown>[] {
  return [
    {
      id: 'lab-evidence-1',
      pillar: 'strength',
      source_type: 'workout',
      projected_impact_low: 0.4,
      projected_impact_high: 1.1,
      reason: 'Bench Press e1RM up 5kg across the last four sessions.',
      created_at: `${addDaysIso(todayIso, -1)}T19:20:00Z`,
    },
  ];
}

/** The lab athlete owns NO cosmetics. Empty is the honest fixture — it is
 *  also the load-bearing one: useDisplayIdentity re-validates the equipped
 *  loadout against these, and an invented unlock would paint art the
 *  athlete cannot actually have. Seeded rather than left to fetch so the
 *  hero's art is the same in mock mode every time. */
export const LAB_SKIN_UNLOCKS: SkinUnlockRow[] = [];
export const LAB_CHARACTER_UNLOCKS: CharacterUnlockRow[] = [];
