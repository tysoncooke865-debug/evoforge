/**
 * ORIGIN ONBOARDING — the candidate engine (candidate model v5).
 *
 * Pure, deterministic, UI-free reference implementation of
 * docs/ORIGIN_CALIBRATION_SPEC.md §3–6. The SQL twin in
 * migrations/047_origin_onboarding.sql (`origin_candidates_for`) is the
 * authority at runtime; THIS engine exists for unit tests and client-side
 * derivations, and the golden fixtures in contracts/fixtures/
 * origin_candidates.json pin the two together (Phase 3 replays the same
 * cases against production SQL).
 *
 * Rules that bind any edit:
 * - EXACTLY THREE DISTINCT candidates, always (the diversity ladder
 *   guarantees 5 ≥ 3 even with every input absent).
 * - Deterministic for identical inputs: ties break by slug order, no
 *   clocks, no randomness.
 * - Missing/invalid inputs can only LOWER a pillar's tier, never crash
 *   (spec §9: out-of-range values are normalised to absent).
 * - The engine RECOMMENDS, it never binds; `requiresChoice` is always true.
 */

import { normalisedFfmi } from '../progression/size-score';
import { reasonText } from './reasons';
import {
  CANDIDATE_MODEL_VERSION,
  ORIGIN_IDS,
  type AffinitySource,
  type CalibrationInput,
  type CandidateResult,
  type OriginCandidate,
  type OriginId,
  type OriginReasonCode,
  type PrimaryGoal,
} from './types';

/** CALIBRATION_V3 baselines, unchanged from migrations 045/046. */
const BASELINES: Record<Exclude<OriginId, 'shredder'>, number> = {
  aesthetic: 60,
  mass: 52,
  titan: 50,
  cardio: 48,
};

/** v4's evidence gate: a pillar below this confidence cannot compete. */
const EVIDENCE_CONFIDENCE_GATE = 25;

/** Tier S clamps (documented constants, spec §3). */
const TIER_S_CLAMP = 20;
const SQUAT_DIVISOR = 1.4;
const DEADLIFT_DIVISOR = 1.6;
const STRENGTH_RATIO_SLOPE = 25;
const FFMI_ANCHOR = { male: 20, female: 17 } as const;
const FFMI_SLOPE = 4;

/** Shredder auto-resonance: the v4 rule, unchanged (spec §3). */
const SHREDDER_BF_THRESHOLD = { male: 20, female: 28 } as const;
const SHREDDER_BF_FRESH_DAYS = 90;

/** Phase-derived body-fat defaults for the size proxy (spec §3). */
function phaseBfDefault(phase: CalibrationInput['nutritionPhase'], sex: 'male' | 'female'): number {
  const base = phase === 'cutting' ? 22 : phase === 'bulking' ? 18 : 20;
  return sex === 'female' ? base + 8 : base;
}

/** Destined map — mirrors paths.fitness_category (spec §4.2). */
const GOAL_ORIGIN: Record<PrimaryGoal, OriginId> = {
  strength: 'titan',
  muscle_gain: 'mass',
  fat_loss: 'shredder',
  cardio: 'cardio',
  aesthetics: 'aesthetic',
};

const GOAL_REASON: Record<PrimaryGoal, OriginReasonCode> = {
  strength: 'STRENGTH_PRIMARY_GOAL',
  muscle_gain: 'MUSCLE_GAIN_PRIMARY_GOAL',
  fat_loss: 'FAT_LOSS_PRIMARY_GOAL',
  cardio: 'CARDIO_PRIMARY_GOAL',
  aesthetics: 'AESTHETIC_PRIMARY_GOAL',
};

/** Goal-adjacency rows (spec §4) — walked on a Resonant collision. The
 *  phase fallback borrows the row of its goal equivalent. */
const GOAL_ADJACENCY: Record<PrimaryGoal, readonly OriginId[]> = {
  strength: ['titan', 'mass', 'aesthetic'],
  muscle_gain: ['mass', 'titan', 'aesthetic'],
  fat_loss: ['shredder', 'cardio', 'aesthetic'],
  cardio: ['cardio', 'shredder', 'titan'],
  aesthetics: ['aesthetic', 'shredder', 'mass'],
};

/** Anomaly battle-style map (spec §4.3b), ordered preference lists. */
const STYLE_ORIGINS: Record<NonNullable<CalibrationInput['battleStyle']>, readonly OriginId[]> = {
  force: ['titan', 'mass'],
  form: ['aesthetic'],
  flow: ['cardio', 'shredder'],
};

const STYLE_REASON: Record<NonNullable<CalibrationInput['battleStyle']>, OriginReasonCode> = {
  force: 'POWER_PLAYSTYLE',
  form: 'PRECISION_PLAYSTYLE',
  flow: 'TEMPO_PLAYSTYLE',
};

/** The static diversity ladder (spec §4.3c) — guarantees a third distinct. */
const DIVERSITY_LADDER: readonly OriginId[] = ['cardio', 'shredder', 'mass', 'titan', 'aesthetic'];

const RESONANT_REASON: Record<Exclude<OriginId, 'shredder'>, OriginReasonCode> = {
  titan: 'HIGH_RELATIVE_STRENGTH',
  mass: 'HIGH_MUSCLE_SIZE',
  cardio: 'HIGH_CARDIO_CAPACITY',
  aesthetic: 'HIGH_AESTHETIC_BALANCE',
};

const UNTAPPED_REASON: Record<Exclude<OriginId, 'shredder'>, OriginReasonCode> = {
  titan: 'UNTAPPED_STRENGTH',
  mass: 'UNTAPPED_SIZE',
  cardio: 'UNTAPPED_CARDIO',
  aesthetic: 'UNTAPPED_AESTHETICS',
};

/* ------------------------------------------------------------------ */
/* Normalisation — invalid values become absent (spec §9).             */
/* ------------------------------------------------------------------ */

function positiveOrNull(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function bfOrNull(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v > 0 && v <= 75 ? v : null;
}

function ageOrNull(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v >= 0 ? v : null;
}

/* ------------------------------------------------------------------ */
/* Resonance affinities (spec §3): tier E then tier S per pillar.      */
/* ------------------------------------------------------------------ */

interface Affinity {
  affinity: number;
  source: 'evidence' | 'self_report';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function affinitiesFor(input: CalibrationInput): Partial<Record<Exclude<OriginId, 'shredder'>, Affinity>> {
  const out: Partial<Record<Exclude<OriginId, 'shredder'>, Affinity>> = {};
  const sex = input.sex === 'female' ? 'female' : 'male';
  const bw = positiveOrNull(input.bodyweightKg);

  (Object.keys(BASELINES) as (Exclude<OriginId, 'shredder'>)[]).forEach((origin) => {
    const pillar = input.pillars[origin];
    if (
      pillar &&
      Number.isFinite(pillar.score) &&
      pillar.score >= 1 && pillar.score <= 100 &&
      Number.isFinite(pillar.confidence) &&
      pillar.confidence >= EVIDENCE_CONFIDENCE_GATE && pillar.confidence <= 100
    ) {
      out[origin] = { affinity: pillar.score - BASELINES[origin], source: 'evidence' };
      return;
    }
    // Tier S — self-report (spec §3). cardio and aesthetic have none.
    if (origin === 'titan' && bw != null) {
      const bench = positiveOrNull(input.benchE1rm);
      const squat = positiveOrNull(input.squatE1rm);
      const deadlift = positiveOrNull(input.deadliftE1rm);
      const ratios = [
        bench != null ? bench / (bw * 1.0) : null,
        squat != null ? squat / (bw * SQUAT_DIVISOR) : null,
        deadlift != null ? deadlift / (bw * DEADLIFT_DIVISOR) : null,
      ].filter((r): r is number => r != null);
      if (ratios.length > 0) {
        const best = Math.max(...ratios);
        out.titan = {
          affinity: clamp((best - 1.0) * STRENGTH_RATIO_SLOPE, -TIER_S_CLAMP, TIER_S_CLAMP),
          source: 'self_report',
        };
      }
    }
    if (origin === 'mass') {
      const height = positiveOrNull(input.heightCm);
      if (height != null && bw != null) {
        const bf = bfOrNull(input.bfMid) ?? phaseBfDefault(input.nutritionPhase, sex);
        const ffmi = normalisedFfmi(height, bw, bf);
        out.mass = {
          affinity: clamp((ffmi - FFMI_ANCHOR[sex]) * FFMI_SLOPE, -TIER_S_CLAMP, TIER_S_CLAMP),
          source: 'self_report',
        };
      }
    }
  });
  return out;
}

/** v4's shredder auto-resonance rule, unchanged (spec §3). */
function shredderAutoResonance(input: CalibrationInput): boolean {
  const bf = bfOrNull(input.bfMid);
  const age = ageOrNull(input.bfAgeDays);
  if (input.nutritionPhase !== 'cutting' || bf == null || age == null) return false;
  if (age > SHREDDER_BF_FRESH_DAYS) return false;
  const sex = input.sex === 'female' ? 'female' : 'male';
  return bf >= SHREDDER_BF_THRESHOLD[sex];
}

/* ------------------------------------------------------------------ */
/* Sub-scores (spec §6 payload) — documented deterministic mappings.   */
/* ------------------------------------------------------------------ */

/** Affinity (±20 tier band) → 0..100 current-strength match. */
function matchFromAffinity(affinity: number): number {
  return clamp(Math.round(50 + affinity * 2.5), 0, 100);
}

function goalAlignmentFor(origin: OriginId, goal: PrimaryGoal | null, phaseGoal: PrimaryGoal | null): number {
  const effective = goal ?? phaseGoal;
  if (effective == null) return 50;
  if (origin === GOAL_ORIGIN[effective]) return 100;
  if (GOAL_ADJACENCY[effective].slice(1).includes(origin)) return 60;
  return 30;
}

function playstyleAlignmentFor(origin: OriginId, style: CalibrationInput['battleStyle']): number {
  if (style == null) return 50;
  const list = STYLE_ORIGINS[style];
  const idx = list.indexOf(origin);
  if (idx === 0) return 100;
  if (idx > 0) return 80;
  return 40;
}

/* ------------------------------------------------------------------ */
/* The engine (spec §4).                                               */
/* ------------------------------------------------------------------ */

function bySlug(a: OriginId, b: OriginId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function generateCandidates(raw: CalibrationInput): CandidateResult {
  // Normalise (spec §9) — everything downstream trusts these.
  const input: CalibrationInput = {
    ...raw,
    heightCm: positiveOrNull(raw.heightCm),
    bodyweightKg: positiveOrNull(raw.bodyweightKg),
    benchE1rm: positiveOrNull(raw.benchE1rm),
    squatE1rm: positiveOrNull(raw.squatE1rm),
    deadliftE1rm: positiveOrNull(raw.deadliftE1rm),
    bfMid: bfOrNull(raw.bfMid),
    bfAgeDays: ageOrNull(raw.bfAgeDays),
  };

  const affinities = affinitiesFor(input);
  const ranked = (Object.entries(affinities) as [Exclude<OriginId, 'shredder'>, Affinity][])
    .sort((a, b) => (b[1].affinity - a[1].affinity) || bySlug(a[0], b[0]));

  /* 1 — RESONANT (spec §4.1) */
  const shredderAuto = shredderAutoResonance(input);
  let resonantId: OriginId;
  let resonantReason: OriginReasonCode;
  let resonantAffinity: number | null = null;
  let resonantSource: AffinitySource;
  if (shredderAuto) {
    resonantId = 'shredder';
    resonantReason = 'CUTTING_PHASE_HIGH_BF';
    resonantSource = 'rule';
  } else if (ranked.length > 0) {
    const [id, a] = ranked[0];
    resonantId = id;
    resonantReason = RESONANT_REASON[id];
    resonantAffinity = a.affinity;
    resonantSource = a.source;
  } else {
    // No tier E/S evidence at all — the goal mapping fills the slot so new
    // users always get three cards (spec §4.1 fallback).
    const goal = input.primaryGoal;
    resonantId = goal != null
      ? GOAL_ORIGIN[goal]
      : input.nutritionPhase === 'cutting' ? 'shredder'
        : input.nutritionPhase === 'bulking' ? 'mass' : 'aesthetic';
    resonantReason = 'BALANCED_ATHLETE';
    resonantSource = 'fallback';
  }

  /* 2 — DESTINED (spec §4.2) */
  const goal = input.primaryGoal;
  const phaseGoal: PrimaryGoal | null = goal == null
    ? input.nutritionPhase === 'cutting' ? 'fat_loss'
      : input.nutritionPhase === 'bulking' ? 'muscle_gain' : 'aesthetics'
    : null;
  const destinedReason: OriginReasonCode = goal != null ? GOAL_REASON[goal] : 'PHASE_INFERRED_GOAL';
  const adjacency = GOAL_ADJACENCY[goal ?? phaseGoal ?? 'aesthetics'];
  const destinedId = adjacency.find((id) => id !== resonantId) as OriginId;

  /* 3 — ANOMALY (spec §4.3) */
  const taken = new Set<OriginId>([resonantId, destinedId]);
  let anomalyId: OriginId | null = null;
  let anomalyReason: OriginReasonCode = 'CONTRAST_PATH';
  let anomalyAffinity: number | null = null;
  // (a) the second-highest tier E/S affinity — a real secondary strength.
  const second = ranked.find(([id]) => !taken.has(id));
  if (second) {
    anomalyId = second[0];
    anomalyReason = UNTAPPED_REASON[second[0]];
    anomalyAffinity = second[1].affinity;
  }
  // (b) the stated battle-style preference.
  if (anomalyId == null && input.battleStyle != null) {
    const pick = STYLE_ORIGINS[input.battleStyle].find((id) => !taken.has(id));
    if (pick) {
      anomalyId = pick;
      anomalyReason = STYLE_REASON[input.battleStyle];
    }
  }
  // (c) the static diversity ladder — always terminates (5 ≥ 3).
  if (anomalyId == null) {
    anomalyId = DIVERSITY_LADDER.find((id) => !taken.has(id)) as OriginId;
    anomalyReason = 'CONTRAST_PATH';
  }

  const phaseGoalForAlign = goal == null ? phaseGoal : null;
  const build = (
    originId: OriginId,
    recommendationType: OriginCandidate['recommendationType'],
    reason: OriginReasonCode,
    affinity: number | null,
  ): OriginCandidate => ({
    originId,
    recommendationType,
    score: affinity != null ? round1(affinity) : 0,
    reasonCodes: [reason],
    currentStrengthMatch: affinity != null ? matchFromAffinity(affinity) : 50,
    goalAlignment: goalAlignmentFor(originId, goal, phaseGoalForAlign),
    playstyleAlignment: playstyleAlignmentFor(originId, input.battleStyle),
  });

  const candidates: CandidateResult['candidates'] = [
    build(resonantId, 'resonant', resonantReason, resonantAffinity),
    build(destinedId, 'destined', destinedReason, null),
    build(anomalyId, 'anomaly', anomalyReason, anomalyAffinity),
  ];

  return {
    version: CANDIDATE_MODEL_VERSION,
    candidates,
    recommendedOrigin: resonantSource === 'evidence' ? resonantId : destinedId,
    requiresChoice: true,
    resonantSource,
  };
}

/** reasonText re-exported so UI imports one module for candidate display. */
export { reasonText };
export { ORIGIN_IDS };
