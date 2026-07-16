/**
 * PROGRESSION_OVERHAUL — the shared shapes (spec §9/§13). Pure types; the
 * calculators speak these, the hooks marshal database rows into them.
 */

export type ConfidenceLabel = 'provisional' | 'moderate' | 'high' | 'verified' | 'elite_verified';

export interface PillarResult {
  /** 1–100, full precision — display rounding happens at the edge. */
  score: number;
  /** 0–100. */
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  evidenceCount: number;
  missingEvidence: string[];
  limitingFactors: string[];
}

export type PillarKey = 'size' | 'aesthetics' | 'strength' | 'cardio';

export interface EvoPillars {
  size: PillarResult;
  aesthetics: PillarResult;
  strength: PillarResult;
  cardio: PillarResult;
}

export interface EvoRatingResult {
  /** Full-precision rating after soft caps, 1–100. */
  rawRating: number;
  /** Math.floor of raw (100 stays 100). */
  displayedRating: number;
  /** 0–100 hundredths toward the next displayed rating. */
  evolutionProgress: number;
  /** Tier descriptor for the displayed rating. */
  descriptor: string;
  /** Which pillar most limits the next tier (or overall geometric drag). */
  limitingPillar: PillarKey;
  /** A tier gate is currently compressing the raw score. */
  tierLocked: boolean;
  /** Human-readable gate explanations, empty when unlocked. */
  gateExplanations: string[];
  /** min of pillar confidences drives the overall label (spec §13). */
  overallConfidence: number;
  confidenceLabel: ConfidenceLabel;
  modelVersion: string;
}

/** The confidence bands, shared by every pillar service. */
export function confidenceLabelFor(confidence: number, eliteVerified = false): ConfidenceLabel {
  if (eliteVerified) return 'elite_verified';
  if (confidence >= 85) return 'verified';
  if (confidence >= 65) return 'high';
  if (confidence >= 40) return 'moderate';
  return 'provisional';
}

/** Scores live in [1, 100] — a zero would annihilate a geometric mean. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(100, value));
}
