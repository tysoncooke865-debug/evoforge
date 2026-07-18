/**
 * Line-by-line port of `domain/avatar_stats.py :: calculate_avatar_stats()`,
 * reshaped like summary.ts: Python reads the database inside the function;
 * here the Query hooks inject rows and latest-values, and this stays pure.
 *
 * THE BLEND IS THE POINT. A profile-only approximation shipped first and
 * called a real aesthetic athlete "Mass Monster" -- the branch decision needs
 * the whole mix: AI physique ratings, leanness from body fat, cardio volume,
 * logged muscle sets. Every weight and threshold below is Python's, verbatim;
 * int() is Math.trunc, and safe_num defaults ride along.
 */

import { determineAvatarBranch, type Branch } from './avatar-stats';
import { safeNum, score0100 } from './physique-ratings';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { estimated1rm, inferMuscleGroup, isCountedSet } from './workouts';
import { pyFloat } from './py';

export interface PhysiqueValues {
  physique_score: number | null;
  leanness_score: number | null;
  symmetry_score: number | null;
  muscularity_score: number | null;
}

export interface AvatarStatsInputs {
  workoutRows: WorkoutRow[];
  level: number;
  latestBodyweight: number | null;
  bfMid: number | null;
  physique: PhysiqueValues;
  cardioMinutes: number;
  cardioDistanceKm: number;
  /** Onboarding v2's profile.deadlift_e1rm -- an 008 column Streamlit cannot
   *  see, so feeding it here is a documented client-side deviation
   *  (PARITY.md). Null/0 means unknown and the curve grades two lifts. */
  profileDeadliftE1rm: number | null;
}

export interface AvatarStats {
  level: number;
  strengthScore: number;
  sizeScore: number;
  leannessScore: number;
  conditioningScore: number;
  aestheticScore: number;
  characterClass: string;
  buildType: string;
  weakPointFocus: string;
  branch: Branch;
  benchE1rm: number;
  squatE1rm: number;
  deadliftE1rm: number;
  bodyweight: number;
}

/** `current_exercise_best_1rm`, over injected rows. */
export function bestE1rmFor(rows: WorkoutRow[], exerciseName: string): number {
  let best = 0;
  for (const r of normaliseWorkoutLog(rows)) {
    if (String(r.exercise) === exerciseName) {
      const weight = pyFloat(r.weight) ?? 0;
      const reps = Math.trunc(pyFloat(r.reps) ?? 0);
      best = Math.max(best, estimated1rm(weight, reps));
    }
  }
  return best;
}

/** `muscle_heat_map`: valid deduped sets counted per inferred muscle group. */
export function muscleHeatMap(rows: WorkoutRow[]): Map<string, number> {
  const heat = new Map<string, number>();
  for (const r of normaliseWorkoutLog(rows)) {
    if (isCountedSet(r.weight, r.reps)) {
      const muscle = inferMuscleGroup(r.exercise);
      heat.set(muscle, (heat.get(muscle) ?? 0) + 1);
    }
  }
  return heat;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/**
 * The strength standards curve: each relative-e1RM ratio maps through real
 * training milestones -- novice 25, intermediate 50, advanced 75, elite 100 --
 * linear between anchors, flat past elite. Line-for-line port of
 * domain/avatar_stats.py::strength_score_from_ratios (which replaced the old
 * (bench/1.5)*55 + (squat/2.0)*45 linear scale on 2026-07-11); every anchor
 * edge is pinned by avatar.json's strength_score_from_ratios goldens.
 */
const BENCH_STRENGTH_ANCHORS: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [0.75, 25.0], [1.25, 50.0], [1.75, 75.0], [2.25, 100.0],
];
const SQUAT_STRENGTH_ANCHORS: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [1.0, 25.0], [1.5, 50.0], [2.0, 75.0], [2.5, 100.0],
];
const DEADLIFT_STRENGTH_ANCHORS: readonly (readonly [number, number])[] = [
  [0.0, 0.0], [1.25, 25.0], [1.75, 50.0], [2.25, 75.0], [2.75, 100.0],
];

type Anchors = readonly (readonly [number, number])[];

/**
 * SEX CALIBRATION (2026-07-12, Tyson: "are females statistics calculated
 * different to men? if not please change this") — a documented client-side
 * deviation in PARITY.md's spirit, layered like branches-v2: the pinned
 * algorithm is untouched, only its CONSTANTS are parameterised, and the
 * DEFAULT is byte-identical male behaviour so every golden still passes.
 * The female values re-anchor each scale to female physiology so equal
 * relative performance earns equal points:
 *  - strength anchors follow women's strength-standards tables (novice 25 /
 *    intermediate 50 / advanced 75 / elite 100), ~0.65-0.72x the male ratios;
 *  - leanness scores 100 from 16% body fat (female essential fat is ~12%,
 *    not 8% — a shredded woman at 16% is the physiological peer of a
 *    shredded man at 8%);
 *  - the size bodyweight window and frame labels shift to female ranges
 *    (a 58 kg female athlete is not a "Cutting Frame" outlier).
 */
export interface SexCalibration {
  benchAnchors: Anchors;
  squatAnchors: Anchors;
  deadliftAnchors: Anchors;
  /** Body fat % that scores leanness 100, and points lost per % above it. */
  leanBfFloor: number;
  leanSlope: number;
  /** score0100 window for the size blend's bodyweight component (kg). */
  bwLow: number;
  bwHigh: number;
  /** Bench ratio counted as "solid" for the no-AI size fallback. */
  solidBenchRatio: number;
  /** Heavy / Athletic / Lean frame thresholds (kg), descending. */
  frameHeavy: number;
  frameAthletic: number;
  frameLean: number;
  /** Python's default when no bodyweight was ever logged (kg). */
  defaultBodyweight: number;
}

export const MALE_CALIBRATION: SexCalibration = {
  benchAnchors: BENCH_STRENGTH_ANCHORS,
  squatAnchors: SQUAT_STRENGTH_ANCHORS,
  deadliftAnchors: DEADLIFT_STRENGTH_ANCHORS,
  leanBfFloor: 8,
  leanSlope: 6.5,
  bwLow: 65,
  bwHigh: 88,
  solidBenchRatio: 1.0,
  frameHeavy: 85,
  frameAthletic: 78,
  frameLean: 72,
  defaultBodyweight: 77.0,
};

export const FEMALE_CALIBRATION: SexCalibration = {
  benchAnchors: [
    [0.0, 0.0], [0.5, 25.0], [0.85, 50.0], [1.2, 75.0], [1.6, 100.0],
  ],
  squatAnchors: [
    [0.0, 0.0], [0.75, 25.0], [1.15, 50.0], [1.6, 75.0], [2.05, 100.0],
  ],
  deadliftAnchors: [
    [0.0, 0.0], [0.95, 25.0], [1.35, 50.0], [1.8, 75.0], [2.3, 100.0],
  ],
  leanBfFloor: 16,
  leanSlope: 5.0,
  bwLow: 50,
  bwHigh: 75,
  solidBenchRatio: 0.7,
  frameHeavy: 72,
  frameAthletic: 64,
  frameLean: 58,
  defaultBodyweight: 62.0,
};

function anchorPoints(ratio: unknown, anchors: readonly (readonly [number, number])[]): number {
  const r = safeNum(ratio, 0.0);
  if (r <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [loR, loP] = anchors[i - 1];
    const [hiR, hiP] = anchors[i];
    if (r <= hiR) return loP + ((r - loR) / (hiR - loR)) * (hiP - loP);
  }
  return anchors[anchors.length - 1][1];
}

export function strengthScoreFromRatios(
  benchRatio: unknown,
  squatRatio: unknown,
  deadliftRatio: unknown = 0.0,
  cal: SexCalibration = MALE_CALIBRATION
): number {
  const benchPts = anchorPoints(benchRatio, cal.benchAnchors);
  const squatPts = anchorPoints(squatRatio, cal.squatAnchors);
  const dl = safeNum(deadliftRatio, 0.0);
  let blended: number;
  if (dl <= 0) {
    // Deadlift unknown: grade the two lifts we can see. Unlogged is not
    // weak -- the same rule that keeps conditioning off 0/100 without
    // cardio logs.
    blended = benchPts * 0.55 + squatPts * 0.45;
  } else {
    const deadliftPts = anchorPoints(dl, cal.deadliftAnchors);
    blended = benchPts * 0.4 + squatPts * 0.3 + deadliftPts * 0.3;
  }
  return Math.trunc(Math.max(0, Math.min(blended, 100)));
}

export function calculateAvatarStats(
  inputs: AvatarStatsInputs,
  cal: SexCalibration = MALE_CALIBRATION
): AvatarStats {
  const heat = muscleHeatMap(inputs.workoutRows);

  let bench = bestE1rmFor(inputs.workoutRows, 'Barbell Bench Press (Strength)');
  if (bench <= 0) {
    bench = Math.max(
      bestE1rmFor(inputs.workoutRows, 'Barbell Bench Press'),
      bestE1rmFor(inputs.workoutRows, 'Paused Barbell Bench Press')
    );
  }
  const squat = bestE1rmFor(inputs.workoutRows, 'Barbell Back Squat');
  // Deadlift: logged barbell deadlifts if that lift ever enters the catalog
  // (Romanian Deadlift is a different lift and does not count), else the
  // onboarding e1RM. Unknown stays 0 and the curve grades two lifts.
  const deadlift = Math.max(
    bestE1rmFor(inputs.workoutRows, 'Barbell Deadlift'),
    safeNum(inputs.profileDeadliftE1rm, 0)
  );

  const bodyweight =
    inputs.latestBodyweight && inputs.latestBodyweight > 0
      ? inputs.latestBodyweight
      : cal.defaultBodyweight;

  const benchRatio = bodyweight ? bench / bodyweight : 0;
  const squatRatio = bodyweight ? squat / bodyweight : 0;
  const deadliftRatio = bodyweight ? deadlift / bodyweight : 0;

  // Strength: relative e1RM through the standards curve (anchors above).
  const strengthScore = strengthScoreFromRatios(benchRatio, squatRatio, deadliftRatio, cal);

  // Size: blend logs, strength, bodyweight and the AI physique rating, so
  // limited history cannot make size look 2/100.
  let muscleSets = 0;
  for (const sets of heat.values()) muscleSets += sets;

  const volumeSizeComponent = clamp(Math.trunc(muscleSets / 4), 0, 100);
  const strengthSizeComponent = Math.trunc(clamp(strengthScore * 0.85, 0, 100));

  const aiMuscularity = inputs.physique.muscularity_score;
  const aiPhysique = inputs.physique.physique_score;

  let aiSizeComponent: number;
  if (aiMuscularity !== null) {
    aiSizeComponent = Math.trunc(clamp((aiMuscularity / 15) * 100, 0, 100));
  } else if (aiPhysique !== null) {
    aiSizeComponent = Math.trunc(clamp((aiPhysique / 15) * 100, 0, 100));
  } else {
    // Conservative baseline from strength/bodyweight, not a beginner score.
    aiSizeComponent = benchRatio >= cal.solidBenchRatio ? 55 : 45;
  }

  const bodyweightComponent = score0100(bodyweight, cal.bwLow, cal.bwHigh);

  const sizeScore = Math.trunc(
    Math.max(
      25, // minimum baseline so the avatar does not look broken
      Math.min(
        aiSizeComponent * 0.35 +
          strengthSizeComponent * 0.3 +
          bodyweightComponent * 0.2 +
          volumeSizeComponent * 0.15,
        100
      )
    )
  );

  let leannessScore: number;
  if (inputs.bfMid !== null && safeNum(inputs.bfMid, 0) > 0) {
    leannessScore = Math.trunc(
      clamp(100 - (safeNum(inputs.bfMid) - cal.leanBfFloor) * cal.leanSlope, 0, 100)
    );
  } else {
    const aiLean = inputs.physique.leanness_score;
    leannessScore = Math.trunc((safeNum(aiLean, 7.5) / 15) * 100);
  }

  // Conditioning: no cardio logs means "unlogged", not 0/100.
  const minutes = safeNum(inputs.cardioMinutes, 0);
  const distance = safeNum(inputs.cardioDistanceKm, 0);
  let conditioningScore: number;
  if (minutes <= 0 && distance <= 0) {
    conditioningScore = 35;
  } else {
    conditioningScore = Math.trunc(
      Math.max(25, Math.min(30 + (minutes / 1000) * 45 + (distance / 100) * 25, 100))
    );
  }

  const aiPhysScore = (safeNum(inputs.physique.physique_score, 8.0) / 15) * 100;
  const symmetryScore = (safeNum(inputs.physique.symmetry_score, 8.0) / 15) * 100;

  const aestheticScore = Math.trunc(
    clamp(
      leannessScore * 0.35 + sizeScore * 0.25 + symmetryScore * 0.2 + aiPhysScore * 0.2,
      0,
      100
    )
  );

  let characterClass: string;
  if (strengthScore >= 75 && aestheticScore >= 70) characterClass = 'Aesthetic Hybrid';
  else if (leannessScore >= 80) characterClass = 'Shredded Assassin';
  else if (strengthScore >= 80) characterClass = 'Strength Titan';
  else if (sizeScore >= 70) characterClass = 'Mass Builder';
  else if (conditioningScore >= 70) characterClass = 'Combat Athlete';
  else characterClass = 'Rising Aesthetic';

  let buildType: string;
  if (bodyweight >= cal.frameHeavy) buildType = 'Heavy Frame';
  else if (bodyweight >= cal.frameAthletic) buildType = 'Athletic Frame';
  else if (bodyweight >= cal.frameLean) buildType = 'Lean Frame';
  else buildType = 'Cutting Frame';

  // Weakest of the aesthetically-prioritised muscles; strict < keeps the
  // earlier entry on ties, exactly like the Python loop.
  let weakPointFocus = 'Balanced';
  if (heat.size > 0) {
    const priorityOrder: [string, string][] = [
      ['Upper Chest', 'Upper chest'],
      ['Side Delts', 'Side delts'],
      ['Back Width', 'Lat width'],
      ['Rear Delts', 'Rear delts'],
      ['Abs', 'Core/abs'],
      ['Quads', 'Legs'],
    ];
    let lowest: [number, string] | null = null;
    for (const [muscle, label] of priorityOrder) {
      const val = Math.trunc(heat.get(muscle) ?? 0);
      if (lowest === null || val < lowest[0]) {
        lowest = [val, label];
      }
    }
    if (lowest) weakPointFocus = lowest[1];
  }

  const branch = determineAvatarBranch({
    strength_score: strengthScore,
    size_score: sizeScore,
    conditioning_score: conditioningScore,
    aesthetic_score: aestheticScore,
  });

  return {
    level: inputs.level,
    strengthScore,
    sizeScore,
    leannessScore,
    conditioningScore,
    aestheticScore,
    characterClass,
    buildType,
    weakPointFocus,
    branch,
    benchE1rm: bench,
    squatE1rm: squat,
    deadliftE1rm: deadlift,
    bodyweight,
  };
}
