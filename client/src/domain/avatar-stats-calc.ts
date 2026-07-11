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
import { estimated1rm, inferMuscleGroup } from './workouts';
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
    const weight = pyFloat(r.weight) ?? 0;
    const reps = pyFloat(r.reps) ?? 0;
    if (weight > 0 && reps > 0) {
      const muscle = inferMuscleGroup(r.exercise);
      heat.set(muscle, (heat.get(muscle) ?? 0) + 1);
    }
  }
  return heat;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

export function calculateAvatarStats(inputs: AvatarStatsInputs): AvatarStats {
  const heat = muscleHeatMap(inputs.workoutRows);

  let bench = bestE1rmFor(inputs.workoutRows, 'Barbell Bench Press (Strength)');
  if (bench <= 0) {
    bench = Math.max(
      bestE1rmFor(inputs.workoutRows, 'Barbell Bench Press'),
      bestE1rmFor(inputs.workoutRows, 'Paused Barbell Bench Press')
    );
  }
  const squat = bestE1rmFor(inputs.workoutRows, 'Barbell Back Squat');

  const bodyweight =
    inputs.latestBodyweight && inputs.latestBodyweight > 0 ? inputs.latestBodyweight : 77.0;

  const benchRatio = bodyweight ? bench / bodyweight : 0;
  const squatRatio = bodyweight ? squat / bodyweight : 0;

  // Strength: relative e1RM. 1.5x bench + 2x squat is around 100.
  const strengthScore = Math.trunc(clamp((benchRatio / 1.5) * 55 + (squatRatio / 2.0) * 45, 0, 100));

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
    aiSizeComponent = benchRatio >= 1.0 ? 55 : 45;
  }

  const bodyweightComponent = score0100(bodyweight, 65, 88);

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
    leannessScore = Math.trunc(clamp(100 - (safeNum(inputs.bfMid) - 8) * 6.5, 0, 100));
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
  if (bodyweight >= 85) buildType = 'Heavy Frame';
  else if (bodyweight >= 78) buildType = 'Athletic Frame';
  else if (bodyweight >= 72) buildType = 'Lean Frame';
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
    bodyweight,
  };
}
