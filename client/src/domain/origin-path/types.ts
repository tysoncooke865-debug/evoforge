/**
 * ORIGIN EVOLUTION PATH — the vocabulary.
 *
 * ONE engine, five configurations. There is no Titan module, no Shredder
 * module: every origin is a value of `OriginPathConfig`, and every screen
 * and rule reads the config rather than branching on an id. Adding a sixth
 * origin is a config entry, a `paths` row and an art package — not a
 * codebase (docs/EVOLUTION_PATH.md §"Adding a future Origin").
 *
 * IDs ARE THE DEPLOYED SLUGS. `paths.slug`, every sprite line, every skin
 * table and live user rows key on aesthetic/mass/titan/cardio/shredder;
 * the brief's Speedster and Hybrid are display names over `cardio` and
 * `mass`. Display labels are never identifiers — the whole reason this
 * separation exists.
 */

import type { OriginId } from '@/domain/origin/types';

export type { OriginId };

/** 0 Dormant · 1 Awakened · 2-4 the long-term transformations. */
export type OriginLevel = 0 | 1 | 2 | 3 | 4;

export type ChapterId = 1 | 2 | 3 | 4;

/** Why a week's requirement was reduced. Recorded, never inferred. */
export type WeekKind = 'standard' | 'deload' | 'injury_adjusted';

/** The reward kinds the beta ships. Every one is a complete, pre-approved
 *  asset or a piece of text — nothing here is composed at runtime, and
 *  nothing calls a generative API (the sprite-pipeline constraint). */
export type RewardKind =
  | 'title'
  | 'portrait'
  | 'visual_effect'
  | 'nameplate'
  | 'share_theme'
  | 'background'
  | 'sound_theme'
  | 'frame'
  | 'entrance'
  | 'badge'
  | 'evolution_preview'
  | 'level_transformation';

export interface OriginReward {
  /** `${originId}_c1_w${week}` — matches origin_path_rewards.reward_id. */
  rewardId: string;
  weekIndex: number;
  chapter: ChapterId;
  kind: RewardKind;
  label: string;
  description: string;
  /** Automatic rewards land the instant the week qualifies. Manual is
   *  reserved for genuine CHOICE rewards; the beta ships none. */
  claimMode: 'automatic' | 'manual';
}

/**
 * A complete character package for one Origin Level. The application swaps
 * the WHOLE package when the origin evolves — it never attaches a helmet to
 * a body, because the sprite pipeline is not reliable enough for modular
 * equipment and the critical progression loop must never depend on it.
 *
 * Every field is optional and every consumer has a fallback: a level whose
 * art has not landed renders the silhouette treatment the app already uses
 * ("FORM NOT YET FORGED"), never a broken image.
 */
export interface OriginLevelAsset {
  level: OriginLevel;
  /** The art stage this level borrows from (1-4). Level 0 uses stage 1 in
   *  the dormant treatment — Origin Level is NOT avatar stage. */
  artStage: 1 | 2 | 3 | 4;
  name: string;
  /** One line the athlete reads on the reveal screen. */
  blurb: string;
  manifestKey: string;
}

export interface OriginChapter {
  id: ChapterId;
  name: string;
  /** Inclusive qualified-week range that this chapter spans. */
  fromWeek: number;
  toWeek: number;
  /** The Origin Level reaching `toWeek` unlocks. */
  unlocksLevel: OriginLevel;
  summary: string;
  /** False for II-IV in the beta: the model is complete, the content is not. */
  authored: boolean;
}

/**
 * How a week qualifies. Percentage-of-plan, so it adapts to a 3-day and a
 * 6-day athlete without a second rule.
 */
export interface QualificationRule {
  /** Fraction of planned sessions required, rounded UP. */
  ratio: number;
  /** Deload / injury weeks drop this many sessions (never below `floor`). */
  reliefSessions: number;
  floor: number;
  /** Planned-session count assumed when the athlete never told us. */
  defaultPlannedSessions: number;
}

/**
 * The final real-world gate. ARCHITECTURE ONLY in the beta — no Level 4
 * exists to gate yet, and the brief is explicit that the first
 * implementation stays conservative and deterministic. An assessment is a
 * stored measurement compared against a threshold by application code; an
 * AI may explain a result, never decide one.
 */
export interface AssessmentRule {
  id: string;
  label: string;
  /** The stored metric this reads. Deliberately a small closed set. */
  metric: 'bench_e1rm' | 'squat_e1rm' | 'deadlift_e1rm' | 'bodyfat_pct' | 'cardio_minutes' | 'total_sets';
  comparator: 'gte' | 'lte';
  /** Multiple of bodyweight for lifts, absolute otherwise. */
  target: number;
  unit: 'x_bodyweight' | 'percent' | 'minutes' | 'count';
}

export interface RecommendationRule {
  goal: 'strength' | 'muscle_gain' | 'fat_loss' | 'cardio' | 'aesthetics';
  weight: number;
}

export interface OriginPathConfig {
  id: OriginId;
  /** The deployed display name (paths.display_name). */
  name: string;
  /** The brief's name for this origin, when it differs. Documentation only —
   *  never rendered, never an identifier. */
  specName: string;
  /** The real-world outcome, in the athlete's language. Not lore. */
  promise: string;
  description: string;
  recommendationRules: RecommendationRule[];
  levelAssets: OriginLevelAsset[];
  chapters: OriginChapter[];
  weeklyRewards: OriginReward[];
  qualificationRules: QualificationRule;
  assessmentRules: AssessmentRule[];
}

/** The server's `origin_path_state()` payload, as the client consumes it. */
export interface OriginPathState {
  ok: boolean;
  hasPath: boolean;
  originPathId: OriginId | null;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  currentLevel: OriginLevel;
  activeChapter: ChapterId;
  activeWeek: number;
  qualifiedWeeks: number;
  selectedTrainingDays: number[];
  startedAt: string | null;
  firstWorkoutCompletedAt: string | null;
  thisWeek: {
    weekStart: string;
    plannedSessions: number;
    requiredSessions: number;
    completedSessions: number;
    qualifiedAt: string | null;
  } | null;
  nextReward: {
    rewardId: string;
    kind: RewardKind;
    label: string;
    description: string | null;
    weekIndex: number;
  } | null;
  unlockedRewards: {
    rewardId: string;
    kind: RewardKind;
    label: string;
    weekIndex: number;
    unlockedAt: string;
    claimedAt: string | null;
  }[];
}

/** The structured result of applying one workout. */
export interface ApplyWorkoutResult {
  ok: boolean;
  applied: boolean;
  reason?: string;
  originPathId: OriginId | null;
  currentLevel: OriginLevel;
  /** Non-null only on the transition — this is what triggers the ceremony. */
  levelUnlocked: OriginLevel | null;
  awakened: boolean;
  qualifiedWeeks: number;
  activeWeek: number;
  activeChapter: ChapterId;
  weekCompletedSessions: number;
  weekRequiredSessions: number;
  weekQualified: boolean;
  rewardsUnlocked: { rewardId: string; kind: RewardKind; label: string }[];
}
