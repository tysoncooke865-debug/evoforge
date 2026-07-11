/**
 * PLACEMENT V2 — the onboarding formula for the reworked flow.
 *
 * V1 (calculateStartingLevel, parity-pinned, still used by the Streamlit app)
 * let athletes self-score physique and leanness. V2 removes self-scoring:
 * those two inputs now come from the AI scan (mapped to the same 0-15 scale)
 * or, when the scan is skipped, from DOCUMENTED derived defaults — never a
 * slider. Lifts gain the deadlift. Points:
 *
 *   bench:    >=120:+28 >=100:+22 >=90:+18 >=80:+14 >=60:+8   (v1 bands)
 *   squat:    >=180:+18 >=140:+14 >=100:+9                     (v1 bands)
 *   deadlift: >=220:+18 >=180:+14 >=140:+9 >=100:+5            (new)
 *   years:    >=5:+16 >=3:+12 >=1:+7                           (v1 bands)
 *   physique (0-15) + leanness (0-15) added truncated, as in v1.
 *   clamp 1..100.
 *
 * The nutrition phase NEVER grants level — it only shapes the leanness
 * default when no scan/body-fat data exists (a cutter is likelier lean than a
 * "see food" bulker), and is stored for future goal features.
 */

export type NutritionPhase = 'cutting' | 'maintaining' | 'bulking' | 'flexible';

export interface PlacementInputs {
  benchE1rm: number;
  squatE1rm: number;
  deadliftE1rm: number;
  trainingYears: number;
  /** From the AI scan, 0-15; null = scan skipped. */
  aiPhysique: number | null;
  /** From the AI scan, 0-15; null = scan skipped. */
  aiLeanness: number | null;
  phase: NutritionPhase;
}

/** Physique default when the scan is skipped: earned from the bar, capped. */
export function derivedPhysiqueDefault(bench: number, squat: number, deadlift: number): number {
  let score = 4;
  if (bench >= 100) score += 2;
  if (squat >= 140) score += 2;
  if (deadlift >= 180) score += 2;
  return Math.min(10, score);
}

/** Leanness default when the scan is skipped: phase-informed, conservative. */
export function derivedLeannessDefault(phase: NutritionPhase): number {
  switch (phase) {
    case 'cutting':
      return 8;
    case 'maintaining':
      return 6;
    case 'bulking':
      return 4;
    default:
      return 5;
  }
}

export function startingLevelV2(inputs: PlacementInputs): number {
  let level = 1;

  const b = inputs.benchE1rm;
  if (b >= 120) level += 28;
  else if (b >= 100) level += 22;
  else if (b >= 90) level += 18;
  else if (b >= 80) level += 14;
  else if (b >= 60) level += 8;

  const s = inputs.squatE1rm;
  if (s >= 180) level += 18;
  else if (s >= 140) level += 14;
  else if (s >= 100) level += 9;

  const d = inputs.deadliftE1rm;
  if (d >= 220) level += 18;
  else if (d >= 180) level += 14;
  else if (d >= 140) level += 9;
  else if (d >= 100) level += 5;

  const y = inputs.trainingYears;
  if (y >= 5) level += 16;
  else if (y >= 3) level += 12;
  else if (y >= 1) level += 7;

  const physique =
    inputs.aiPhysique ?? derivedPhysiqueDefault(inputs.benchE1rm, inputs.squatE1rm, inputs.deadliftE1rm);
  const leanness = inputs.aiLeanness ?? derivedLeannessDefault(inputs.phase);
  level += Math.trunc(Math.max(0, Math.min(15, physique)));
  level += Math.trunc(Math.max(0, Math.min(15, leanness)));

  return Math.max(1, Math.min(Math.trunc(level), 100));
}
