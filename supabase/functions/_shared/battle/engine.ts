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

export const ENGINE_VERSION = 1;

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

// ---------------------------------------------------------------- rewards

export const XP_WIN = 150;
export const XP_LOSS = 50;
export const XP_DRAW = 75;

export function battleXp(myPoints: number, theirPoints: number): number {
  if (myPoints > theirPoints) return XP_WIN;
  if (myPoints < theirPoints) return XP_LOSS;
  return XP_DRAW;
}
