/**
 * PROGRESSION_OVERHAUL — the Weekly Evo Review, as one pure function
 * (spec §15B). The server (edge function) and any preview share THIS
 * implementation: evidence rows in → the confirmed new state, what
 * changed and why, what was rejected, and the forecast out.
 *
 * Size/Aesthetics are PRESERVED between scans (only new scan evidence
 * moves them); Strength/Cardio recompute from confirmed evidence with
 * decline protection; confidence updates every review; peak ratchets.
 */

import { calculateCardioScore, type CardioEvidence } from './cardio-score';
import { stalenessOf } from './evidence';
import { assembleEvoRating } from './evo-rating';
import { applyConfirmedRating, initialEvoState, type EvoState } from './evo-state';
import { EVO_RATING_MODEL_VERSION } from './model-versions';
import { calculateStrengthScore, type StrengthObservation, type StrengthResult } from './strength-score';
import type { EvoPillars, EvoRatingResult, PillarKey, PillarResult } from './types';

export interface ReviewInputs {
  todayIso: string;
  sex: 'male' | 'female';
  fallbackBodyweightKg: number;
  /** Prior confirmed state; null = first ever review. */
  priorState: EvoState | null;
  /** Prior pillar results (carried for Size/Aesthetics preservation). */
  priorPillars: EvoPillars | null;
  /** ALL strength observations (the calculator windows them itself). */
  strengthObservations: StrengthObservation[];
  /** Cardio evidence assembled by the caller. */
  cardioEvidence: CardioEvidence;
  /** Fresh scan-derived pillar results, when a scan happened since last review. */
  scanSize: PillarResult | null;
  scanAesthetics: PillarResult | null;
  /** Provisional fallbacks for a first review with no scan. */
  provisionalSize: PillarResult;
  provisionalAesthetics: PillarResult;
  lastStrengthEvidenceIso: string | null;
  lastCardioEvidenceIso: string | null;
}

export interface PillarChange {
  pillar: PillarKey;
  before: number | null;
  after: number;
  note: string;
}

export interface ReviewOutcome {
  pillars: EvoPillars;
  rating: EvoRatingResult;
  state: EvoState;
  changes: PillarChange[];
  /** Evidence areas the review examined and left untouched, with why. */
  preserved: string[];
  /** The forecast: ordered, honest, range-based next actions (spec §19). */
  recommendations: string[];
  modelVersion: string;
  strength: StrengthResult;
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  size: 'Size',
  aesthetics: 'Aesthetics',
  strength: 'Strength',
  cardio: 'Cardio',
};

export function runEvoReview(inputs: ReviewInputs): ReviewOutcome {
  const changes: PillarChange[] = [];
  const preserved: string[] = [];

  // --- Strength: recompute from evidence, decline-protected upstream. ---
  const strength = calculateStrengthScore(
    inputs.strengthObservations,
    inputs.sex,
    inputs.todayIso,
    inputs.fallbackBodyweightKg
  );
  const strengthStaleness = stalenessOf('strength', inputs.lastStrengthEvidenceIso, inputs.todayIso);
  if (strengthStaleness === 'stale') {
    strength.confidence = Math.round(strength.confidence * 0.6);
    strength.limitingFactors.push('strength evidence is stale — train to refresh it');
  }

  // --- Cardio: recompute; provisional handling is inside the calculator. ---
  const cardio = calculateCardioScore(inputs.cardioEvidence);
  const cardioStaleness = stalenessOf('cardio', inputs.lastCardioEvidenceIso, inputs.todayIso);
  if (cardioStaleness === 'stale' && cardio.evidenceCount > 0) {
    cardio.confidence = Math.round(cardio.confidence * 0.6);
  }

  // --- Size / Aesthetics: ONLY a new scan moves them. ---
  const size = inputs.scanSize ?? inputs.priorPillars?.size ?? inputs.provisionalSize;
  const aesthetics =
    inputs.scanAesthetics ?? inputs.priorPillars?.aesthetics ?? inputs.provisionalAesthetics;
  if (!inputs.scanSize) preserved.push('Size (no new scan evidence)');
  if (!inputs.scanAesthetics) preserved.push('Aesthetics (no new scan evidence)');

  const pillars: EvoPillars = { size, aesthetics, strength, cardio };
  const rating = assembleEvoRating(pillars, {
    allCoreStrengthCategoriesAtLeast85: strength.allCoreCategoriesAtLeast85,
  });

  // --- State: peak ratchets, starting anchors once. ---
  const state =
    inputs.priorState === null
      ? initialEvoState(rating.rawRating)
      : applyConfirmedRating(inputs.priorState, rating.rawRating);

  // --- Changes narrative. ---
  const prior = inputs.priorPillars;
  for (const key of ['size', 'aesthetics', 'strength', 'cardio'] as PillarKey[]) {
    const before = prior ? prior[key].score : null;
    const after = pillars[key].score;
    if (before === null || Math.abs(after - before) >= 0.05) {
      changes.push({
        pillar: key,
        before,
        after,
        note:
          before === null
            ? `${PILLAR_LABEL[key]} assessed`
            : `${PILLAR_LABEL[key]} ${after > before ? '+' : ''}${(after - before).toFixed(1)}`,
      });
    }
  }

  // --- The forecast: evidence-gathering before promises, ranges only. ---
  const recommendations: string[] = [];
  for (const m of cardio.missingEvidence.slice(0, 1)) {
    recommendations.push(`Complete ${m} — Cardio confidence is ${cardio.confidenceLabel}`);
  }
  for (const m of strength.missingEvidence.slice(0, 2)) {
    recommendations.push(`Log ${m.replace(' evidence', '').toLowerCase()} work to cover the category`);
  }
  if (rating.tierLocked && rating.gateExplanations[0]) {
    recommendations.push(rating.gateExplanations[0]);
  }
  if (!inputs.scanSize) {
    recommendations.push('Complete a guided Evo Scan — Size and Aesthetics may update');
  }

  return {
    pillars,
    rating,
    state,
    changes,
    preserved,
    recommendations: recommendations.slice(0, 4),
    modelVersion: EVO_RATING_MODEL_VERSION,
    strength,
  };
}
