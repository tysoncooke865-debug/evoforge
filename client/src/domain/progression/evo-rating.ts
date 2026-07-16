/**
 * PROGRESSION_OVERHAUL — the Evo Rating core (spec §4–§8). One central
 * implementation of the 30/25/30/15 weighted geometric mean, the display
 * derivation, the tier descriptors, and the anti-specialist tier gates
 * with SMOOTH soft-cap compression.
 *
 * Pure and deterministic: pillars in, rating out, every gate explained.
 * The geometric mean is the point — a weak pillar drags the whole rating,
 * so no single exceptional quality can hide an absent one.
 */

import { EVO_RATING_MODEL_VERSION } from './model-versions';
import {
  clampScore,
  confidenceLabelFor,
  type EvoPillars,
  type EvoRatingResult,
  type PillarKey,
} from './types';

export const EVO_WEIGHTS = {
  size: 0.3,
  aesthetics: 0.25,
  strength: 0.3,
  cardio: 0.15,
} as const;

export function calculateRawEvoRating(input: {
  sizeScore: number;
  aestheticsScore: number;
  strengthScore: number;
  cardioScore: number;
}): number {
  const size = clampScore(input.sizeScore);
  const aesthetics = clampScore(input.aestheticsScore);
  const strength = clampScore(input.strengthScore);
  const cardio = clampScore(input.cardioScore);

  return (
    100 *
    Math.pow(size / 100, EVO_WEIGHTS.size) *
    Math.pow(aesthetics / 100, EVO_WEIGHTS.aesthetics) *
    Math.pow(strength / 100, EVO_WEIGHTS.strength) *
    Math.pow(cardio / 100, EVO_WEIGHTS.cardio)
  );
}

export function deriveEvoDisplay(rawRating: number): {
  displayedRating: number;
  evolutionProgress: number;
} {
  const safeRating = Math.max(1, Math.min(Number.isFinite(rawRating) ? rawRating : 1, 100));
  const displayedRating = safeRating >= 100 ? 100 : Math.floor(safeRating);
  const evolutionProgress =
    displayedRating >= 100 ? 100 : Math.round((safeRating - displayedRating) * 100);
  return { displayedRating, evolutionProgress };
}

export const EVO_RATING_TIERS = [
  { min: 1, max: 19, name: 'Untrained' },
  { min: 20, max: 39, name: 'Novice' },
  { min: 40, max: 54, name: 'Trained' },
  { min: 55, max: 69, name: 'Developed' },
  { min: 70, max: 79, name: 'Advanced' },
  { min: 80, max: 89, name: 'Exceptional' },
  { min: 90, max: 94, name: 'Elite' },
  { min: 95, max: 97, name: 'Professional Calibre' },
  { min: 98, max: 99, name: 'Apex' },
  { min: 100, max: 100, name: 'The Standard' },
] as const;

export function descriptorFor(displayedRating: number): string {
  const tier = EVO_RATING_TIERS.find((t) => displayedRating >= t.min && displayedRating <= t.max);
  return tier?.name ?? 'Untrained';
}

/** Anti-specialist gates (spec §8): entering `rating` requires the minima. */
export const EVO_TIER_REQUIREMENTS = [
  { rating: 70, minSize: 60, minAesthetics: 55, minStrength: 50, minCardio: 35 },
  { rating: 80, minSize: 72, minAesthetics: 68, minStrength: 65, minCardio: 45 },
  { rating: 90, minSize: 85, minAesthetics: 82, minStrength: 80, minCardio: 60 },
  { rating: 95, minSize: 93, minAesthetics: 92, minStrength: 88, minCardio: 70 },
  { rating: 98, minSize: 98, minAesthetics: 97, minStrength: 93, minCardio: 80 },
  { rating: 100, minSize: 99.5, minAesthetics: 99.5, minStrength: 95, minCardio: 85 },
] as const;

const GATE_PILLARS: readonly (readonly [PillarKey, 'minSize' | 'minAesthetics' | 'minStrength' | 'minCardio'])[] = [
  ['size', 'minSize'],
  ['aesthetics', 'minAesthetics'],
  ['strength', 'minStrength'],
  ['cardio', 'minCardio'],
];

export interface SoftCapResult {
  /** The rating after compression — never crosses a failed gate. */
  cappedRating: number;
  /** True when a gate compressed the raw value. */
  tierLocked: boolean;
  /** The gate that is compressing, if any. */
  lockedGate: (typeof EVO_TIER_REQUIREMENTS)[number] | null;
  /** The pillar(s) failing that gate, worst deficit first. */
  failingPillars: PillarKey[];
  /** Human sentences: "Cardio must reach 60 to enter Evo Rating 90." */
  explanations: string[];
}

/**
 * Smooth soft caps (spec §8): a raw 92 that fails the 90-gate reads ~89.x,
 * never 79 — progress compresses asymptotically toward the locked gate,
 * and the UI explains exactly which pillar unlocks it. Deterministic:
 * capped = G−1 + (1 − e^(−overshoot/4)), always in [G−1, G).
 */
export function applyTierRequirementSoftCaps(input: {
  rawRating: number;
  sizeScore: number;
  aestheticsScore: number;
  strengthScore: number;
  cardioScore: number;
}): SoftCapResult {
  const raw = Math.max(1, Math.min(Number.isFinite(input.rawRating) ? input.rawRating : 1, 100));
  const scores: Record<PillarKey, number> = {
    size: clampScore(input.sizeScore),
    aesthetics: clampScore(input.aestheticsScore),
    strength: clampScore(input.strengthScore),
    cardio: clampScore(input.cardioScore),
  };

  // The LOWEST failed gate at or below the raw rating is the one that binds.
  for (const gate of EVO_TIER_REQUIREMENTS) {
    if (raw < gate.rating) break;
    const failing = GATE_PILLARS.filter(([pillar, key]) => scores[pillar] < gate[key])
      .sort((a, b) => (gate[a[1]] - scores[a[0]]) < (gate[b[1]] - scores[b[0]]) ? 1 : -1)
      .map(([pillar]) => pillar);
    if (failing.length > 0) {
      const overshoot = raw - (gate.rating - 1);
      const cappedRating = gate.rating - 1 + (1 - Math.exp(-overshoot / 4));
      const label: Record<PillarKey, string> = {
        size: 'Size',
        aesthetics: 'Aesthetics',
        strength: 'Strength',
        cardio: 'Cardio',
      };
      const explanations = failing.map((pillar) => {
        const key = GATE_PILLARS.find(([p]) => p === pillar)![1];
        return `${label[pillar]} must reach ${gate[key]} to enter Evo Rating ${gate.rating}. Current ${label[pillar]}: ${Math.floor(scores[pillar])}`;
      });
      return { cappedRating, tierLocked: true, lockedGate: gate, failingPillars: failing, explanations };
    }
  }
  return { cappedRating: raw, tierLocked: false, lockedGate: null, failingPillars: [], explanations: [] };
}

/** Level 100 is manual + elite (spec §6); automation caps at 99. */
export function qualifiesForLevel100(input: {
  sizeScore: number;
  aestheticsScore: number;
  strengthScore: number;
  cardioScore: number;
  allCoreStrengthCategoriesAtLeast85: boolean;
  overallConfidence: number;
  manualEliteVerification: boolean;
}): boolean {
  return (
    input.sizeScore >= 99.5 &&
    input.aestheticsScore >= 99.5 &&
    input.strengthScore >= 95 &&
    input.cardioScore >= 85 &&
    input.allCoreStrengthCategoriesAtLeast85 &&
    input.overallConfidence >= 95 &&
    input.manualEliteVerification === true
  );
}

/** The pillar whose weighted geometric drag on the rating is largest. */
export function limitingPillarOf(scores: Record<PillarKey, number>): PillarKey {
  let worst: PillarKey = 'size';
  let worstDrag = -Infinity;
  for (const pillar of Object.keys(EVO_WEIGHTS) as PillarKey[]) {
    const drag = EVO_WEIGHTS[pillar] * (Math.log(100) - Math.log(clampScore(scores[pillar])));
    if (drag > worstDrag) {
      worstDrag = drag;
      worst = pillar;
    }
  }
  return worst;
}

/** The whole assembly: pillars → the displayed truth, gates and all. */
export function assembleEvoRating(
  pillars: EvoPillars,
  opts: { manualEliteVerification?: boolean; allCoreStrengthCategoriesAtLeast85?: boolean } = {}
): EvoRatingResult {
  const scores = {
    sizeScore: pillars.size.score,
    aestheticsScore: pillars.aesthetics.score,
    strengthScore: pillars.strength.score,
    cardioScore: pillars.cardio.score,
  };
  const overallConfidence = Math.min(
    pillars.size.confidence,
    pillars.aesthetics.confidence,
    pillars.strength.confidence,
    pillars.cardio.confidence
  );

  let raw = calculateRawEvoRating(scores);
  const caps = applyTierRequirementSoftCaps({ rawRating: raw, ...scores });
  raw = caps.cappedRating;

  // Automation caps at 99 unless the full manual L100 bar is met.
  const l100 = qualifiesForLevel100({
    ...scores,
    allCoreStrengthCategoriesAtLeast85: opts.allCoreStrengthCategoriesAtLeast85 ?? false,
    overallConfidence,
    manualEliteVerification: opts.manualEliteVerification ?? false,
  });
  if (!l100 && raw >= 99.995) raw = 99.99;

  const { displayedRating, evolutionProgress } = deriveEvoDisplay(l100 ? 100 : raw);
  const limiting =
    caps.failingPillars[0] ??
    limitingPillarOf({
      size: scores.sizeScore,
      aesthetics: scores.aestheticsScore,
      strength: scores.strengthScore,
      cardio: scores.cardioScore,
    });

  return {
    rawRating: l100 ? 100 : raw,
    displayedRating,
    evolutionProgress,
    descriptor: descriptorFor(displayedRating),
    limitingPillar: limiting,
    tierLocked: caps.tierLocked,
    gateExplanations: caps.explanations,
    overallConfidence,
    confidenceLabel: confidenceLabelFor(overallConfidence),
    modelVersion: EVO_RATING_MODEL_VERSION,
  };
}
