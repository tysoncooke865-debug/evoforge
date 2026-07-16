/**
 * PROGRESSION_OVERHAUL — the Size pillar (spec §9). Weighted geometric
 * combination of four sub-scores:
 *   height-normalised lean mass 40% · regional development 35% ·
 *   frame-adjusted measurements 15% · muscle completeness 10%.
 *
 * v1 evidence sources (all optional — missing evidence lowers confidence
 * and is NAMED, never zero-scored):
 *   lean mass ← height + bodyweight + body-fat RANGE (FFMI, the range's
 *   midpoint scored, its width discounted from confidence);
 *   regional ← the Evo Scan's regional scores (P6) or the legacy physique
 *   muscularity score as a uniform provisional stand-in;
 *   frame ← wrist/height proportion when measured;
 *   completeness ← how many regions have NON-ABSENT development.
 */

import { evidenceConfidence } from './confidence';
import { SIZE_MODEL_VERSION } from './model-versions';
import { clampScore, confidenceLabelFor, type PillarResult } from './types';

export const SIZE_MODEL = SIZE_MODEL_VERSION;

export const REGIONAL_KEYS = [
  'chest', 'frontDelts', 'sideDelts', 'rearDelts', 'backWidth', 'backThickness',
  'biceps', 'triceps', 'forearms', 'abdominals', 'glutes', 'quadriceps',
  'hamstrings', 'calves',
] as const;
export type RegionalKey = (typeof REGIONAL_KEYS)[number];

export interface SizeEvidence {
  sex: 'male' | 'female';
  heightCm?: number | null;
  /** Prefer the seven-day median where the caller has it. */
  bodyweightKg?: number | null;
  /** The ai-bodyfat RANGE — its width is uncertainty, never ignored. */
  bfLow?: number | null;
  bfHigh?: number | null;
  /** 1–100 per region, absent = unknown. */
  regionalScores?: Partial<Record<RegionalKey, number>> | null;
  /** Legacy physique muscularity (0–15 scale) as a provisional stand-in. */
  legacyMuscularity15?: number | null;
  wristCm?: number | null;
  /** Count of distinct guided scans ever completed. */
  scanCount?: number;
}

/** FFMI anchors → score, piecewise linear. Sex-calibrated: equal RELATIVE
 *  development earns equal points (the FEMALE_CALIBRATION philosophy). */
const FFMI_ANCHORS: Record<'male' | 'female', ReadonlyArray<readonly [ffmi: number, score: number]>> = {
  male: [[14, 5], [16, 20], [18, 42], [20, 62], [22, 80], [24, 92], [25, 96], [26, 99]],
  female: [[11, 5], [13, 20], [15, 42], [17, 62], [19, 80], [21, 92], [22, 96], [23, 99]],
};

export function scoreFromAnchors(
  value: number,
  anchors: ReadonlyArray<readonly [number, number]>
): number {
  if (!Number.isFinite(value)) return 1;
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
  }
  return anchors[anchors.length - 1][1];
}

/** Height-normalised FFMI: leanKg/h² + 6.1·(1.8 − h). */
export function normalisedFfmi(heightCm: number, bodyweightKg: number, bfPercent: number): number {
  const h = heightCm / 100;
  const lean = bodyweightKg * (1 - bfPercent / 100);
  return lean / (h * h) + 6.1 * (1.8 - h);
}

export function calculateSizeScore(evidence: SizeEvidence): PillarResult {
  const missing: string[] = [];
  const limiting: string[] = [];
  let evidenceCount = 0;

  // --- Lean mass (40%) ---
  let leanMassScore = 40; // conservative provisional
  const hasBody =
    (evidence.heightCm ?? 0) > 0 && (evidence.bodyweightKg ?? 0) > 0 &&
    evidence.bfLow != null && evidence.bfHigh != null;
  if (hasBody) {
    const bfMid = ((evidence.bfLow as number) + (evidence.bfHigh as number)) / 2;
    const ffmi = normalisedFfmi(evidence.heightCm as number, evidence.bodyweightKg as number, bfMid);
    leanMassScore = scoreFromAnchors(ffmi, FFMI_ANCHORS[evidence.sex]);
    evidenceCount += 2;
  } else {
    if (!((evidence.heightCm ?? 0) > 0)) missing.push('height');
    if (!((evidence.bodyweightKg ?? 0) > 0)) missing.push('bodyweight');
    if (evidence.bfLow == null || evidence.bfHigh == null) missing.push('body-fat estimate');
  }

  // --- Regional development (35%) ---
  const regional = evidence.regionalScores ?? null;
  const regionalValues = regional
    ? REGIONAL_KEYS.map((k) => regional[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
  let regionalScore: number;
  if (regionalValues.length >= 6) {
    regionalScore =
      regionalValues.reduce((s, v) => s + clampScore(v), 0) / regionalValues.length;
    evidenceCount += 1;
    const weakest = Math.min(...regionalValues);
    if (weakest < regionalScore - 20) limiting.push('a lagging muscle region');
  } else if (evidence.legacyMuscularity15 != null && evidence.legacyMuscularity15 > 0) {
    regionalScore = clampScore((evidence.legacyMuscularity15 / 15) * 100);
    evidenceCount += 1;
    missing.push('regional scan (guided Evo Scan)');
  } else {
    regionalScore = 40;
    missing.push('regional scan (guided Evo Scan)');
  }

  // --- Frame adjustment (15%) ---
  let frameScore = 55; // neutral prior: no frame data neither helps nor hurts much
  if ((evidence.wristCm ?? 0) > 0 && (evidence.heightCm ?? 0) > 0) {
    // Wrist/height around 0.095–0.11 is typical; muscle carried on a
    // lighter frame reads slightly higher, heavier frame slightly lower —
    // the ADJUSTMENT is small by design (±10).
    const ratio = (evidence.wristCm as number) / (evidence.heightCm as number);
    frameScore = 55 + Math.max(-10, Math.min(10, (0.1 - ratio) * 400));
    evidenceCount += 1;
  } else {
    missing.push('wrist measurement');
  }

  // --- Completeness (10%) ---
  let completenessScore = 50;
  if (regionalValues.length >= 6) {
    const developed = regionalValues.filter((v) => v >= 35).length;
    completenessScore = clampScore((developed / regionalValues.length) * 100);
    if (completenessScore < 70) limiting.push('undeveloped regions');
  } else {
    missing.push('full-body regional coverage');
  }

  const score =
    100 *
    Math.pow(clampScore(leanMassScore) / 100, 0.4) *
    Math.pow(clampScore(regionalScore) / 100, 0.35) *
    Math.pow(clampScore(frameScore) / 100, 0.15) *
    Math.pow(clampScore(completenessScore) / 100, 0.1);

  // Confidence: evidence pieces + scan history, discounted by bf-range width.
  let confidence = evidenceConfidence(evidenceCount + (evidence.scanCount ?? 0));
  if (hasBody) {
    const width = (evidence.bfHigh as number) - (evidence.bfLow as number);
    if (width > 6) confidence = Math.round(confidence * 0.8); // wide bf range = soft evidence
  } else {
    confidence = Math.min(confidence, 35);
  }

  return {
    score: clampScore(score),
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    evidenceCount,
    missingEvidence: missing,
    limitingFactors: limiting,
  };
}
