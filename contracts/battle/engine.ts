/**
 * THE BATTLE ENGINE — single source of truth for battle scoring + catalogs.
 *
 * This file lives in contracts/battle/engine.ts and is copied BYTE-FOR-BYTE
 * to:
 *   client/src/domain/battle/engine.ts            (display previews only)
 *   supabase/functions/_shared/battle/engine.ts   (authoritative)
 * scripts/verify-battle-engine.mjs fails CI on any drift, the verify-tokens
 * pattern applied to logic. Edit HERE, then run the script with --write.
 *
 * It is deliberately self-contained (zero imports) so the same bytes load
 * under Deno and Metro. All math uses Math.trunc and stays in integers at
 * the component boundaries, so both copies agree exactly.
 *
 * Only the SERVER copy writes scores anywhere; the client copy renders live
 * progress and previews. Character stats enter through exactly one gate,
 * characterMultiplier(), hard-capped at +15% — player performance always
 * dominates (BATTLE_ARENA_DESIGN.md §7).
 */

export const ENGINE_VERSION = 2;

// ---------------------------------------------------------------- objects

export interface BattleObject {
  key: string;
  name: string;
  emoji: string;
  /** The fiction: what the object "weighs" on screen. */
  displayKg: number;
  /** The reality: effective volume (kg) that lifts it in a BLITZ round. */
  blitzTargetKg: number;
}

/** Blitz-tier objects. spec.scale = displayKg / target (the game weight). */
export const BATTLE_OBJECTS: readonly BattleObject[] = [
  { key: 'motorcycle', name: 'Motorcycle', emoji: '🏍️', displayKg: 220, blitzTargetKg: 1800 },
  { key: 'car', name: 'Car', emoji: '🚗', displayKg: 1500, blitzTargetKg: 2100 },
  { key: 'rhino', name: 'Rhino', emoji: '🦏', displayKg: 2300, blitzTargetKg: 2400 },
  { key: 'helicopter', name: 'Helicopter', emoji: '🚁', displayKg: 5700, blitzTargetKg: 2700 },
  { key: 'truck', name: 'Truck', emoji: '🚛', displayKg: 9000, blitzTargetKg: 2850 },
  { key: 'fire_engine', name: 'Fire Engine', emoji: '🚒', displayKg: 12000, blitzTargetKg: 3000 },
];

export function objectByKey(key: string): BattleObject {
  const found = BATTLE_OBJECTS.find((o) => o.key === key);
  return found ?? BATTLE_OBJECTS[0];
}

// ----------------------------------------------------- exercise coefficients

/**
 * Volume = weight × reps × coefficient. Coefficients discount leverage and
 * machine assistance so a leg-press kilogram never equals a squat kilogram.
 * Exact names first, then pattern rules IN ORDER, then the floor default —
 * every exercise counts something, nothing counts more than a barbell lift.
 */
const COEFF_EXACT: Record<string, number> = {
  'Barbell Back Squat': 1.0,
  'Barbell Bench Press': 1.0,
  'Barbell Bench Press (Strength)': 1.0,
  'Paused Barbell Bench Press': 1.0,
  'Barbell Deadlift': 1.0,
  'Romanian Deadlift': 0.85,
  'Farmer Carry': 0.7,
  'Leg Press': 0.45,
  'Hack Squat Machine': 0.65,
  'Bulgarian Split Squat': 0.8,
  'T-Bar Row': 0.8,
};

const COEFF_RULES: readonly (readonly [string, number])[] = [
  ['smith machine', 0.8],
  ['barbell', 0.95],
  ['dumbbell', 0.85],
  ['ez-bar', 0.8],
  ['leg press', 0.45],
  ['hack squat', 0.65],
  ['machine', 0.65],
  ['cable', 0.5],
  ['pulldown', 0.6],
  ['pull-up', 0.7],
  ['row', 0.7],
  ['dip', 0.7],
  ['push-up', 0.5],
  ['raise', 0.45],
  ['curl', 0.45],
  ['fly', 0.45],
  ['extension', 0.45],
  ['pushdown', 0.45],
  ['kickback', 0.4],
  ['crunch', 0.4],
  ['sit-up', 0.4],
  ['face pull', 0.5],
];

export const COEFF_DEFAULT = 0.5;

export function coefficientFor(exercise: string): number {
  const exact = COEFF_EXACT[exercise];
  if (exact !== undefined) return exact;
  const lower = exercise.toLowerCase();
  for (const [needle, coeff] of COEFF_RULES) {
    if (lower.includes(needle)) return coeff;
  }
  return COEFF_DEFAULT;
}

// ---------------------------------------------------------------- scoring

/** One validated volume event (payload rebuilt by the 009 trigger). */
export interface VolumeEvent {
  exercise: string;
  weightKg: number;
  reps: number;
  /** battle_events.server_ts — ISO string; string compare is time compare. */
  serverTs: string;
}

export interface StrengthSpec {
  objectKey: string;
  targetEffectiveKg: number;
  engineVersion: number;
}

export const STRENGTH_BUDGET = 1200;
export const STAT_INFLUENCE_CAP = 0.15;

/** The ONE gate character stats pass through. stat 0→×1.00, 100→×1.15. */
export function characterMultiplier(stat: number): number {
  const clamped = Math.max(0, Math.min(100, stat));
  return 1 + STAT_INFLUENCE_CAP * (clamped / 100);
}

export function effectiveKg(e: VolumeEvent): number {
  if (e.weightKg <= 0 || e.reps <= 0) return 0;
  return e.weightKg * e.reps * coefficientFor(e.exercise);
}

export function totalEffectiveKg(events: readonly VolumeEvent[]): number {
  let total = 0;
  for (const e of events) total += effectiveKg(e);
  return total;
}

/** server_ts of the event whose cumulative volume crosses the target. */
export function finishTs(events: readonly VolumeEvent[], targetKg: number): string | null {
  let total = 0;
  for (const e of events) {
    total += effectiveKg(e);
    if (total >= targetKg) return e.serverTs;
  }
  return null;
}

export interface StrengthComponents {
  completion: number;
  speed: number;
  variety: number;
  overload: number;
  base: number;
  multiplier: number;
  points: number;
  effectiveKg: number;
  finished: boolean;
}

/**
 * The blitz strength round, one athlete. Deterministic given both event
 * streams (speed compares finish times), the athlete's pre-round e1RM bests
 * (overload band) and the snapshot strength stat.
 *
 * SAFETY IS IN THE GRADIENT: overload pays for sets at 75–95% of the
 * athlete's own established e1RM and pays NOTHING above it — a max attempt
 * is worth less than a quality working set, by design.
 */
export function scoreStrengthRound(
  myEvents: readonly VolumeEvent[],
  theirEvents: readonly VolumeEvent[],
  spec: StrengthSpec,
  strengthStat: number,
  myE1rmBefore: Record<string, number>
): StrengthComponents {
  const target = spec.targetEffectiveKg;
  const mine = totalEffectiveKg(myEvents);
  const ratio = target > 0 ? Math.min(1, mine / target) : 0;

  // Completion: 700, linear.
  const completion = Math.trunc(ratio * 700);

  // Speed: 200 first over the line, 120 second; unfinished paces at ≤80.
  const myFinish = finishTs(myEvents, target);
  const theirFinish = finishTs(theirEvents, target);
  let speed: number;
  if (myFinish !== null && (theirFinish === null || myFinish <= theirFinish)) {
    speed = 200;
  } else if (myFinish !== null) {
    speed = 120;
  } else {
    speed = Math.trunc(ratio * 80);
  }

  // Variety: one machine is a rut, not a strategy.
  const distinct = new Set(
    myEvents.filter((e) => effectiveKg(e) > 0).map((e) => e.exercise)
  ).size;
  const variety = distinct >= 4 ? 180 : distinct === 3 ? 120 : distinct === 2 ? 60 : 0;

  // Overload: 20 per set inside the 75–95% band of the athlete's OWN
  // pre-round best e1RM for that exercise, capped at 120. No established
  // best -> no band -> no bonus (a brand-new exercise can't prove overload).
  let qualifying = 0;
  for (const e of myEvents) {
    const best = myE1rmBefore[e.exercise] ?? 0;
    if (best <= 0 || e.weightKg <= 0 || e.reps <= 0) continue;
    const setE1rm = e.weightKg * (1 + e.reps / 30);
    if (setE1rm >= 0.75 * best && setE1rm <= 0.95 * best) qualifying += 1;
  }
  const overload = Math.min(120, qualifying * 20);

  const base = completion + speed + variety + overload;
  const multiplier = characterMultiplier(strengthStat);
  const points = Math.min(STRENGTH_BUDGET, Math.trunc(base * multiplier));

  return {
    completion,
    speed,
    variety,
    overload,
    base,
    multiplier,
    points,
    effectiveKg: Math.trunc(mine),
    finished: myFinish !== null,
  };
}

// ---------------------------------------------------------------- round 2: cardio

export const CARDIO_BUDGET = 1050;

export interface CardioChallenge {
  key: string;
  name: string;
  emoji: string;
  /** Energy units to complete in a 10-minute BLITZ cardio round. */
  blitzTargetUnits: number;
}

export const CARDIO_CHALLENGES: readonly CardioChallenge[] = [
  { key: 'escape_zombies', name: 'Escape The Zombies', emoji: '🧟', blitzTargetUnits: 26 },
  { key: 'outrun_wolf', name: 'Outrun The Wolf', emoji: '🐺', blitzTargetUnits: 32 },
  { key: 'power_city', name: 'Power The City', emoji: '🏙️', blitzTargetUnits: 28 },
  { key: 'climb_mountain', name: 'Climb The Mountain', emoji: '⛰️', blitzTargetUnits: 24 },
  { key: 'cross_desert', name: 'Cross The Desert', emoji: '🏜️', blitzTargetUnits: 22 },
  { key: 'chase_train', name: 'Chase The Train', emoji: '🚂', blitzTargetUnits: 30 },
];

export function cardioChallengeByKey(key: string): CardioChallenge {
  const found = CARDIO_CHALLENGES.find((c) => c.key === key);
  return found ?? CARDIO_CHALLENGES[0];
}

/**
 * Energy Units = minutes × minute-coefficient + km × km-coefficient, per
 * modality — never calories. Tuned so ~10 honest hard minutes lands near a
 * blitz target on ANY machine: a 2.2km run ≈ 28, ten stairmaster minutes
 * ≈ 26, ten boxing minutes ≈ 24.
 */
const CARDIO_MIN_COEFF: Record<string, number> = {
  Run: 0.6,
  'Outdoor walk': 0.4,
  'Treadmill incline walk': 0.5,
  Bike: 0.5,
  Stairmaster: 2.6,
  Boxing: 2.4,
  Other: 0.5,
};

const CARDIO_KM_COEFF: Record<string, number> = {
  Run: 10,
  'Outdoor walk': 5.5,
  'Treadmill incline walk': 6.5,
  Bike: 4,
  Stairmaster: 0,
  Boxing: 0,
  Other: 5,
};

export interface CardioEvent {
  type: string;
  minutes: number;
  distanceKm: number;
  serverTs: string;
}

export function energyUnits(e: CardioEvent): number {
  if (e.minutes <= 0 && e.distanceKm <= 0) return 0;
  const mc = CARDIO_MIN_COEFF[e.type] ?? CARDIO_MIN_COEFF.Other;
  const kc = CARDIO_KM_COEFF[e.type] ?? CARDIO_KM_COEFF.Other;
  return Math.max(0, e.minutes) * mc + Math.max(0, e.distanceKm) * kc;
}

export function totalEnergyUnits(events: readonly CardioEvent[]): number {
  let total = 0;
  for (const e of events) total += energyUnits(e);
  return total;
}

export interface CardioSpec {
  challengeKey: string;
  targetUnits: number;
  engineVersion: number;
}

export interface CardioComponents {
  performance: number;
  speed: number;
  completion: number;
  intensity: number;
  base: number;
  multiplier: number;
  points: number;
  units: number;
  finished: boolean;
}

function cardioFinishTs(events: readonly CardioEvent[], target: number): string | null {
  let total = 0;
  for (const e of events) {
    total += energyUnits(e);
    if (total >= target) return e.serverTs;
  }
  return null;
}

/**
 * The blitz cardio round. A 10-minute window usually holds ONE logged
 * session, so consistency/negative-split components (the FULL-format design)
 * are replaced by an intensity component: units per minute against a 3.0
 * "hard effort" bar. Endurance stat enters through the same capped gate.
 */
export function scoreCardioRound(
  myEvents: readonly CardioEvent[],
  theirEvents: readonly CardioEvent[],
  spec: CardioSpec,
  conditioningStat: number
): CardioComponents {
  const target = spec.targetUnits;
  const units = totalEnergyUnits(myEvents);
  const ratio = target > 0 ? Math.min(1, units / target) : 0;

  const performance = Math.trunc(ratio * 550);

  const myFinish = cardioFinishTs(myEvents, target);
  const theirFinish = cardioFinishTs(theirEvents, target);
  let speed: number;
  if (myFinish !== null && (theirFinish === null || myFinish <= theirFinish)) {
    speed = 200;
  } else if (myFinish !== null) {
    speed = 120;
  } else {
    speed = Math.trunc(ratio * 80);
  }

  const completion = myFinish !== null ? 200 : Math.trunc(ratio * 120);

  let minutes = 0;
  for (const e of myEvents) minutes += Math.max(0, e.minutes);
  const upm = minutes > 0 ? units / minutes : 0;
  const intensity = Math.trunc(Math.min(1, upm / 3.0) * 100);

  const base = performance + speed + completion + intensity;
  const multiplier = characterMultiplier(conditioningStat);
  const points = Math.min(CARDIO_BUDGET, Math.trunc(base * multiplier));

  return {
    performance,
    speed,
    completion,
    intensity,
    base,
    multiplier,
    points,
    units: Math.trunc(units * 10) / 10,
    finished: myFinish !== null,
  };
}

// ---------------------------------------------------------------- round 3: physique

export const PHYSIQUE_BUDGET = 750;

export interface BattlePose {
  key: string;
  name: string;
}

export const BATTLE_POSES: readonly BattlePose[] = [
  { key: 'front_relaxed', name: 'Front Relaxed' },
  { key: 'back_relaxed', name: 'Back Relaxed' },
  { key: 'side_relaxed', name: 'Side Relaxed' },
  { key: 'front_double_bicep', name: 'Front Double Bicep' },
];

export function poseByKey(key: string): BattlePose {
  const found = BATTLE_POSES.find((p) => p.key === key);
  return found ?? BATTLE_POSES[0];
}

export interface PhysiqueVerdict {
  muscular_development: number;
  conditioning: number;
  symmetry: number;
  proportion: number;
  presentation: number;
  compliant: boolean;
  confidence: string; // 'low' | 'medium' | 'high'
}

export interface PhysiqueComponents {
  judged: number;
  base: number;
  multiplier: number;
  points: number;
  floored: boolean;
}

/**
 * The physique round. Five /15 axes weight to a 650 base (the multiplier's
 * headroom keeps a perfect judged score inside the 750 budget). A verdict
 * the AI is not confident in is NEVER ranked: after the retry it scores on
 * the compliance floor alone — 150 for a compliant pose, 50 for showing up.
 * No submission at all is 0.
 */
export function scorePhysiqueRound(
  verdict: PhysiqueVerdict | null,
  aestheticStat: number
): PhysiqueComponents {
  if (verdict === null) {
    return { judged: 0, base: 0, multiplier: 1, points: 0, floored: false };
  }
  if (String(verdict.confidence).toLowerCase() === 'low') {
    const floor = verdict.compliant ? 150 : 50;
    return { judged: 0, base: floor, multiplier: 1, points: floor, floored: true };
  }
  const clamp15 = (v: number) => Math.max(0, Math.min(15, v));
  const judged =
    clamp15(verdict.muscular_development) +
    clamp15(verdict.conditioning) +
    clamp15(verdict.symmetry) +
    clamp15(verdict.proportion) +
    clamp15(verdict.presentation);
  const base = Math.trunc((judged / 75) * 650);
  const multiplier = characterMultiplier(aestheticStat);
  const points = Math.min(PHYSIQUE_BUDGET, Math.trunc(base * multiplier));
  return { judged, base, multiplier, points, floored: false };
}

// ---------------------------------------------------------------- rewards

export const XP_WIN = 150;
export const XP_LOSS = 50;
export const XP_DRAW = 75;

export function battleXp(myPoints: number, theirPoints: number): number {
  if (myPoints > theirPoints) return XP_WIN;
  if (myPoints < theirPoints) return XP_LOSS;
  return XP_DRAW;
}
