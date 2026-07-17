/**
 * ORIGIN ONBOARDING — the candidate model vocabulary (v5).
 * docs/ORIGIN_CALIBRATION_SPEC.md is the contract; this file is its types.
 *
 * OriginId is the FIVE DEPLOYED path slugs (paths.slug, skin lines, sprite
 * sets all key on them). The proposal's colossus/tempest/paragon aliases
 * map to mass/cardio/aesthetic; hybrid was removed from the game
 * (Tyson, 2026-07-16) and is NOT an origin. Display labels are never
 * identifiers.
 */

export const ORIGIN_IDS = ['aesthetic', 'mass', 'titan', 'cardio', 'shredder'] as const;
export type OriginId = (typeof ORIGIN_IDS)[number];

export const CANDIDATE_MODEL_VERSION = 5;

export type RecommendationType = 'resonant' | 'destined' | 'anomaly';

export type PrimaryGoal = 'strength' | 'muscle_gain' | 'fat_loss' | 'cardio' | 'aesthetics';
export type BattleStylePref = 'force' | 'form' | 'flow';

export type OriginReasonCode =
  | 'HIGH_RELATIVE_STRENGTH'
  | 'HIGH_MUSCLE_SIZE'
  | 'HIGH_CARDIO_CAPACITY'
  | 'HIGH_LEANNESS'
  | 'HIGH_AESTHETIC_BALANCE'
  | 'BALANCED_ATHLETE'
  | 'CUTTING_PHASE_HIGH_BF'
  | 'STRENGTH_PRIMARY_GOAL'
  | 'MUSCLE_GAIN_PRIMARY_GOAL'
  | 'FAT_LOSS_PRIMARY_GOAL'
  | 'CARDIO_PRIMARY_GOAL'
  | 'AESTHETIC_PRIMARY_GOAL'
  | 'PHASE_INFERRED_GOAL'
  | 'POWER_PLAYSTYLE'
  | 'PRECISION_PLAYSTYLE'
  | 'TEMPO_PLAYSTYLE'
  | 'UNTAPPED_STRENGTH'
  | 'UNTAPPED_SIZE'
  | 'UNTAPPED_CARDIO'
  | 'UNTAPPED_LEANNESS'
  | 'UNTAPPED_AESTHETICS'
  | 'CONTRAST_PATH';

/** One rating pillar as the calibration consumes it. */
export interface PillarInput {
  score: number;
  confidence: number;
}

/**
 * Canonical calibration inputs — the SAME rows the initial Evo Rating
 * consumes (profile self-report + rating pillars + latest body-fat), never
 * a second assessment system. Every field is optional; absences follow the
 * documented fallbacks and can only LOWER a pillar's tier, never crash.
 */
export interface CalibrationInput {
  sex: 'male' | 'female' | null;
  heightCm: number | null;
  bodyweightKg: number | null;
  benchE1rm: number | null;
  squatE1rm: number | null;
  deadliftE1rm: number | null;
  trainingYears: number | null;
  /** Latest body-fat midpoint + its age in days (freshness gate 90d). */
  bfMid: number | null;
  bfAgeDays: number | null;
  nutritionPhase: 'cutting' | 'maintaining' | 'bulking' | 'flexible' | null;
  primaryGoal: PrimaryGoal | null;
  battleStyle: BattleStylePref | null;
  /** evo_rating_current pillars, when a row exists. Keyed by ORIGIN id
   *  (titan=strength, mass=size, aesthetic=aesthetics, cardio=cardio). */
  pillars: Partial<Record<Exclude<OriginId, 'shredder'>, PillarInput>>;
}

/** Where a resonance affinity came from — orders trust. */
export type AffinitySource = 'evidence' | 'rule' | 'self_report' | 'fallback';

export interface OriginCandidate {
  originId: OriginId;
  recommendationType: RecommendationType;
  /** Calibrated affinity, one decimal (0 for pure goal/ladder picks). */
  score: number;
  /** Ordered by weight — index 0 is the headline reason. */
  reasonCodes: OriginReasonCode[];
  /** 0..100 — how well the CURRENT body/evidence matches this origin. */
  currentStrengthMatch: number;
  /** 1..100 — alignment with the stated (or phase-inferred) goal. */
  goalAlignment: number;
  /** 1..100 — alignment with the stated battle-style preference. */
  playstyleAlignment: number;
}

export interface CandidateResult {
  version: typeof CANDIDATE_MODEL_VERSION;
  candidates: [OriginCandidate, OriginCandidate, OriginCandidate];
  recommendedOrigin: OriginId;
  /** v5 never auto-selects — always true, the player decides. */
  requiresChoice: true;
  /** Which tier backed the resonant slot (drives the recommended rule). */
  resonantSource: AffinitySource;
}
