/**
 * PROGRESSION_OVERHAUL — evidence discipline (spec §11/§17/§18):
 * staleness windows, the decline-confirmation rule, and post-workout
 * projections. Pure; the review function feeds rows in.
 *
 * THE DECLINE RULE: a score may only fall when at least TWO of the last
 * THREE comparable exposures sit below the expected range, the drop
 * exceeds measurement noise, and no protective marker (deload, illness,
 * injury, taper, rehab, travel) covers the window. One bad day is noise.
 */

import { daysBetween } from './confidence';
import type { PillarKey } from './types';

/** Evidence windows in days: fresh until, stale after (spec §18). */
export const EVIDENCE_WINDOWS: Record<PillarKey | 'bodyweight', { freshDays: number; staleDays: number }> = {
  strength: { freshDays: 28, staleDays: 60 },
  cardio: { freshDays: 56, staleDays: 120 },
  size: { freshDays: 42, staleDays: 90 },
  aesthetics: { freshDays: 42, staleDays: 90 },
  bodyweight: { freshDays: 14, staleDays: 45 },
};

export type StalenessStatus = 'fresh' | 'aging' | 'stale';

export function stalenessOf(
  kind: keyof typeof EVIDENCE_WINDOWS,
  lastEvidenceIso: string | null,
  todayIso: string
): StalenessStatus {
  if (!lastEvidenceIso) return 'stale';
  const age = daysBetween(lastEvidenceIso, todayIso);
  const w = EVIDENCE_WINDOWS[kind];
  if (age <= w.freshDays) return 'fresh';
  if (age <= w.staleDays) return 'aging';
  return 'stale';
}

export type ProtectiveMarker = 'deload' | 'illness' | 'injury' | 'taper' | 'rehab' | 'travel' | 'recovery';

/** Relative measurement noise for strength e1RMs — a decline smaller than
 *  this is indistinguishable from a normal day. */
export const STRENGTH_NOISE_RATIO = 0.05;

export interface DeclineCheckInput {
  /** Newest first: the last comparable exposures' scores (e1RM or test score). */
  recentValues: number[];
  /** The established baseline the exposures are judged against. */
  expectedValue: number;
  /** Any protective markers covering the exposure window. */
  markers: ProtectiveMarker[];
  noiseRatio?: number;
}

export interface DeclineVerdict {
  confirmed: boolean;
  reason:
    | 'confirmed'
    | 'insufficient_evidence'
    | 'within_noise'
    | 'protected'
    | 'no_decline';
  /** The confirmed new value when a decline stands (median of the lows). */
  confirmedValue: number | null;
}

export function confirmDecline(input: DeclineCheckInput): DeclineVerdict {
  const noise = input.noiseRatio ?? STRENGTH_NOISE_RATIO;
  if (input.markers.length > 0) return { confirmed: false, reason: 'protected', confirmedValue: null };
  const last3 = input.recentValues.slice(0, 3).filter((v) => Number.isFinite(v) && v > 0);
  if (last3.length < 2) return { confirmed: false, reason: 'insufficient_evidence', confirmedValue: null };

  const threshold = input.expectedValue * (1 - noise);
  const below = last3.filter((v) => v < threshold);
  if (below.length === 0) return { confirmed: false, reason: 'no_decline', confirmedValue: null };
  if (below.length < 2) return { confirmed: false, reason: 'within_noise', confirmedValue: null };

  const sorted = [...below].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { confirmed: true, reason: 'confirmed', confirmedValue: median };
}

/**
 * Post-workout projection (spec §15A): a NEW best e1RM in a category
 * projects Evolution Progress, expressed as a RANGE and stored pending —
 * the weekly review is the only thing that confirms. Attendance projects
 * nothing (that is Forge XP's job).
 */
export interface WorkoutProjection {
  pillar: PillarKey;
  sourceType: 'e1rm_improvement' | 'new_category_coverage' | 'cardio_test';
  projectedImpactLow: number;
  projectedImpactHigh: number;
  reason: string;
}

export function projectFromE1rm(input: {
  category: string;
  previousBestE1rm: number | null;
  newE1rm: number;
}): WorkoutProjection | null {
  if (input.previousBestE1rm === null) {
    return {
      pillar: 'strength',
      sourceType: 'new_category_coverage',
      projectedImpactLow: 2,
      projectedImpactHigh: 8,
      reason: `First ${input.category} evidence recorded`,
    };
  }
  const gain = input.newE1rm / input.previousBestE1rm - 1;
  if (gain <= 0.005) return null; // not meaningfully new evidence
  // ~1% e1RM gain ≈ 3–5 hundredths of Evolution Progress, capped sanely.
  const low = Math.min(25, Math.max(1, Math.round(gain * 300)));
  const high = Math.min(40, Math.max(low + 2, Math.round(gain * 500)));
  return {
    pillar: 'strength',
    sourceType: 'e1rm_improvement',
    projectedImpactLow: low,
    projectedImpactHigh: high,
    reason: `${input.category} e1RM ${input.previousBestE1rm.toFixed(1)} → ${input.newE1rm.toFixed(1)}`,
  };
}
