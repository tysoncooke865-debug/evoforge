/**
 * PROGRESSION_OVERHAUL — the Cardio pillar (spec §12). Geometric:
 * aerobic performance 70% · gym work capacity 20% · recovery 10%.
 *
 * DEMONSTRATED performance only: logging many cardio sessions earns Forge
 * XP, never Cardio Score. Missing evidence is a conservative PROVISIONAL
 * estimate with low confidence and a named next action — never zero
 * (a zero would annihilate the whole geometric Evo Rating).
 */

import { daysBetween, evidenceConfidence, recencyWeight } from './confidence';
import { clampScore, confidenceLabelFor, type PillarResult } from './types';
import { scoreFromAnchors } from './size-score';

export type AerobicTestType =
  | 'run_1_5km'
  | 'run_2_4km'
  | 'run_5km'
  | 'cooper_12min'
  | 'row_2km'
  | 'vo2max_wearable';

export interface AerobicTestResult {
  testType: AerobicTestType;
  /** Seconds for timed tests; metres for cooper; ml/kg/min for vo2. */
  value: number;
  date: string;
  protocolVersion?: string;
  verified?: boolean;
}

/** Test value → score anchors (male; female offsets applied below).
 *  Timed tests: LOWER is better, so anchors descend. */
const AEROBIC_ANCHORS: Record<AerobicTestType, { anchors: readonly (readonly [number, number])[]; lowerBetter: boolean; femaleShift: number }> = {
  // 1.5km run seconds: 330s (5:30) elite → 900s (15:00) untrained.
  run_1_5km: { anchors: [[330, 99], [390, 92], [450, 82], [540, 65], [630, 48], [720, 32], [900, 12]], lowerBetter: true, femaleShift: 0.12 },
  run_2_4km: { anchors: [[560, 99], [660, 92], [780, 80], [900, 65], [1080, 45], [1260, 28], [1500, 12]], lowerBetter: true, femaleShift: 0.12 },
  run_5km: { anchors: [[1080, 99], [1260, 92], [1500, 78], [1800, 60], [2100, 42], [2400, 28], [3000, 10]], lowerBetter: true, femaleShift: 0.12 },
  cooper_12min: { anchors: [[1500, 10], [1900, 28], [2200, 45], [2500, 62], [2800, 78], [3100, 90], [3400, 99]], lowerBetter: false, femaleShift: -0.1 },
  row_2km: { anchors: [[390, 99], [420, 92], [450, 82], [480, 70], [520, 55], [570, 38], [660, 18]], lowerBetter: true, femaleShift: 0.12 },
  vo2max_wearable: { anchors: [[28, 12], [35, 30], [42, 50], [48, 68], [54, 82], [60, 92], [68, 99]], lowerBetter: false, femaleShift: -0.08 },
};

export function scoreAerobicTest(sex: 'male' | 'female', test: AerobicTestResult): number {
  const cfg = AEROBIC_ANCHORS[test.testType];
  const adjusted =
    sex === 'female'
      ? cfg.lowerBetter
        ? test.value / (1 + cfg.femaleShift)
        : test.value * (1 - cfg.femaleShift)
      : test.value;
  return scoreFromAnchors(adjusted, cfg.anchors);
}

export interface CardioEvidence {
  sex: 'male' | 'female';
  aerobicTests: AerobicTestResult[];
  /** 0–100 when a standardised capacity protocol has been completed. */
  workCapacityScore?: number | null;
  /** 1-minute HR recovery in bpm, when measured. */
  hrRecovery1minBpm?: number | null;
  /** LAST-RESORT provisional signal only: any cardio training exists at
   *  all (affects the provisional prior, never a real score). */
  hasCardioTrainingHistory: boolean;
  todayIso: string;
}

export function calculateCardioScore(evidence: CardioEvidence): PillarResult {
  const missing: string[] = [];
  const limiting: string[] = [];
  let evidenceCount = 0;

  // --- Aerobic (70%): best recency-weighted test wins; wearable-only
  // evidence is supporting, capped below verified-test confidence. ---
  let aerobic: number;
  let aerobicConfidence: number;
  const scored = evidence.aerobicTests
    .map((t) => ({
      t,
      s: scoreAerobicTest(evidence.sex, t) * recencyWeight(daysBetween(t.date, evidence.todayIso), { freshDays: 56, staleDays: 180, floor: 0.6 }),
    }))
    .sort((a, b) => b.s - a.s);
  if (scored.length > 0) {
    aerobic = scored[0].s;
    evidenceCount += scored.length;
    const onlyWearable = evidence.aerobicTests.every((t) => t.testType === 'vo2max_wearable');
    aerobicConfidence = onlyWearable ? 55 : scored[0].t.verified ? 85 : 70;
    if (onlyWearable) missing.push('a standardised aerobic test (1.5 km run or 2 km row)');
  } else {
    // Conservative provisional (spec §12's worked example band).
    aerobic = evidence.hasCardioTrainingHistory ? 45 : 35;
    aerobicConfidence = 25;
    missing.push('a standardised aerobic test (1.5 km run or 2 km row)');
    limiting.push('no confirmed aerobic test');
  }

  // --- Work capacity (20%) ---
  let capacity: number;
  if (evidence.workCapacityScore != null && evidence.workCapacityScore > 0) {
    capacity = clampScore(evidence.workCapacityScore);
    evidenceCount += 1;
  } else {
    capacity = Math.max(35, aerobic * 0.9); // provisional: tracks aerobic conservatively
    missing.push('a work-capacity protocol');
  }

  // --- Recovery (10%) ---
  let recovery: number;
  if (evidence.hrRecovery1minBpm != null && evidence.hrRecovery1minBpm > 0) {
    // 1-min HRR: <12 poor → >40 excellent.
    recovery = scoreFromAnchors(evidence.hrRecovery1minBpm, [[10, 15], [15, 30], [20, 45], [25, 60], [30, 75], [35, 86], [45, 96]]);
    evidenceCount += 1;
  } else {
    recovery = Math.max(35, aerobic * 0.9);
    missing.push('heart-rate recovery measurement');
  }

  const score =
    100 *
    Math.pow(clampScore(aerobic) / 100, 0.7) *
    Math.pow(clampScore(capacity) / 100, 0.2) *
    Math.pow(clampScore(recovery) / 100, 0.1);

  const confidence = Math.round(
    Math.min(aerobicConfidence, evidenceConfidence(evidenceCount, { base: 20, max: 88 }))
  );

  return {
    score: clampScore(score),
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    evidenceCount,
    missingEvidence: missing,
    limitingFactors: limiting,
  };
}
