/**
 * PROGRESSION_OVERHAUL — the Aesthetics pillar (spec §10). Geometric:
 * proportions 35% · distribution 25% · definition 25% · symmetry 15%.
 *
 * SAFETY RULES BAKED IN: definition has diminishing returns past the
 * athletic band and a PLATEAU below the healthy floor — chasing ever-lower
 * body fat earns nothing (spec §47). Pose/camera inconsistency lowers
 * CONFIDENCE before it lowers any score.
 *
 * v1 evidence: the Evo Scan's sub-scores when present; otherwise the
 * legacy physique AI ratings (0–15 scales) as provisional stand-ins.
 */

import { evidenceConfidence } from './confidence';
import { clampScore, confidenceLabelFor, type PillarResult } from './types';
import { scoreFromAnchors } from './size-score';

export interface AestheticsEvidence {
  sex: 'male' | 'female';
  /** Direct sub-scores (1–100) from a guided scan, when available. */
  proportionsScore?: number | null;
  distributionScore?: number | null;
  symmetryScore?: number | null;
  /** Body-fat range drives the definition curve. */
  bfLow?: number | null;
  bfHigh?: number | null;
  /** Legacy physique ratings (0–15) as provisional fallbacks. */
  legacyPhysique15?: number | null;
  legacySymmetry15?: number | null;
  legacyLeanness15?: number | null;
  /** Scan-consistency signal: inconsistent pose/camera → confidence hit. */
  scanConsistent?: boolean;
  scanCount?: number;
}

/** Definition vs body-fat%: rises into the athletic band, DIMINISHES near
 *  stage-lean, and PLATEAUS below the healthy floor — leaner-than-floor
 *  earns exactly the floor's score, never more. */
const DEFINITION_ANCHORS: Record<'male' | 'female', ReadonlyArray<readonly [bf: number, score: number]>> = {
  male: [[5, 95], [7, 95], [10, 88], [12, 78], [15, 62], [18, 48], [22, 34], [28, 20], [35, 10]],
  female: [[12, 95], [15, 95], [18, 86], [21, 74], [24, 60], [28, 44], [33, 28], [40, 12]],
};

export function definitionScoreFromBf(sex: 'male' | 'female', bfMid: number): number {
  const anchors = DEFINITION_ANCHORS[sex];
  const floor = anchors[0][0];
  // The plateau: below the healthy floor the score is FLAT.
  return scoreFromAnchors(Math.max(bfMid, floor), anchors);
}

export function calculateAestheticsScore(evidence: AestheticsEvidence): PillarResult {
  const missing: string[] = [];
  const limiting: string[] = [];
  let evidenceCount = 0;

  const from15 = (v: number | null | undefined): number | null =>
    v != null && v > 0 ? clampScore((v / 15) * 100) : null;

  // Proportions 35%
  let proportions = evidence.proportionsScore ?? from15(evidence.legacyPhysique15);
  if (proportions != null) evidenceCount += 1;
  else {
    proportions = 45;
    missing.push('proportion assessment (guided Evo Scan)');
  }

  // Distribution 25% — v1 rides the same physique evidence until regional
  // scans land; named as its own missing item so the UI can ask for it.
  let distribution = evidence.distributionScore ?? from15(evidence.legacyPhysique15);
  if (distribution != null) evidenceCount += 1;
  else {
    distribution = 45;
    missing.push('distribution assessment');
  }

  // Definition 25%
  let definition: number;
  if (evidence.bfLow != null && evidence.bfHigh != null) {
    definition = definitionScoreFromBf(evidence.sex, (evidence.bfLow + evidence.bfHigh) / 2);
    evidenceCount += 1;
  } else {
    const legacy = from15(evidence.legacyLeanness15);
    if (legacy != null) {
      definition = legacy;
      evidenceCount += 1;
    } else {
      definition = 45;
      missing.push('body-fat estimate');
    }
  }

  // Symmetry 15% — normal asymmetry tolerated: scores compress toward 70
  // so minor genetic differences barely register.
  let symmetry = evidence.symmetryScore ?? from15(evidence.legacySymmetry15);
  if (symmetry != null) {
    symmetry = 70 + (clampScore(symmetry) - 70) * 0.75;
    evidenceCount += 1;
  } else {
    symmetry = 60;
    missing.push('symmetry assessment');
  }

  const score =
    100 *
    Math.pow(clampScore(proportions) / 100, 0.35) *
    Math.pow(clampScore(distribution) / 100, 0.25) *
    Math.pow(clampScore(definition) / 100, 0.25) *
    Math.pow(clampScore(symmetry) / 100, 0.15);

  if (definition < proportions - 20) limiting.push('conditioning');
  if (proportions < 45) limiting.push('proportions');

  let confidence = evidenceConfidence(evidenceCount + (evidence.scanCount ?? 0));
  // Pose/camera inconsistency: LOWER CONFIDENCE, never the score (spec §10).
  if (evidence.scanConsistent === false) confidence = Math.round(confidence * 0.7);
  if (evidenceCount === 0) confidence = Math.min(confidence, 30);

  return {
    score: clampScore(score),
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    evidenceCount,
    missingEvidence: missing,
    limitingFactors: limiting,
  };
}
