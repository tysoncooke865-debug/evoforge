/**
 * Port of the pure functions of `domain/workouts.py`. The DataFrame-shaped
 * ones (`workout_summary`, `load_log`, heat maps) are Phase 3: they read
 * Supabase and their TS form will be TanStack Query hooks over the same rows.
 */

import { MUSCLE_MAP } from './catalogs';
import { pyFloat } from './py';

/** Epley estimated 1RM. Zero reps is zero, never a divide, never a phantom PR. */
export function estimated1rm(weight: number, reps: number): number {
  return reps > 0 ? weight * (1 + reps / 30) : 0;
}

/**
 * THE COUNTED-SET PREDICATE (061, 2026-07-19): a set counts when
 * `weight >= 0 (present and numeric) AND reps > 0` — 0 kg is bodyweight
 * work and earns its flat XP. Missing/garbage weight is NOT zero (the
 * pyFloat raise-vs-default rule): the server guard rejects null weight and
 * the client must agree or drift appears. PR/e1RM paths keep `weight > 0`
 * (a 0 kg set can never be a PR) — deliberately NOT this function.
 *
 * Every surface that counts sets goes through here; summary.ts, the hub's
 * setsFor, the workout page's validRowsFor, week-status, session-plan,
 * scheduled-streak and the estimates all agree by construction.
 */
export function isCountedSet(weight: unknown, reps: unknown): boolean {
  const w = pyFloat(weight);
  const r = pyFloat(reps);
  return w !== null && w >= 0 && r !== null && r > 0;
}

const UPPER_CHEST_HINTS = ['incline', 'upper chest', 'low-to-high'];
const UPPER_CHEST_CONFIRM = ['press', 'bench', 'fly', 'chest'];
const CHEST = ['bench', 'pec', 'chest', 'fly', 'push-up', 'push up'];
const SIDE_DELTS = ['lateral raise', 'side delt', 'machine lateral', 'lean-away'];
const REAR_DELTS = ['rear delt', 'reverse pec', 'face pull'];
const BACK_WIDTH = ['pulldown', 'pull-up', 'pull up', 'lat pullover', 'straight-arm', 'straight arm', 'lat'];
const BACK_THICKNESS = ['row', 't-bar', 'machine high row', 'high row'];
const BICEPS = ['curl', 'bicep', 'preacher', 'hammer'];
const FOREARM_OVERRIDES = ['wrist', 'reverse', 'farmer'];
const TRICEPS = ['tricep', 'pushdown', 'overhead extension', 'close-grip', 'dip'];
const QUADS = ['squat', 'leg press', 'leg extension', 'quad', 'bulgarian'];
const HAMSTRINGS = ['leg curl', 'hamstring', 'romanian', 'rdl', 'back extension'];
const ADDUCTORS = ['adduction', 'adductor'];
const GLUTES = ['abduction', 'kickback', 'hip thrust', 'glute'];
const ABS = ['crunch', 'sit-up', 'sit up', 'leg raise', 'knee raise', 'abs'];

const includesAny = (haystack: string, needles: string[]) =>
  needles.some((n) => haystack.includes(n));

/**
 * Map an exercise name to a muscle group. Exact MUSCLE_MAP lookup first, then
 * the same ordered substring cascade as Python -- ORDER IS LOAD-BEARING
 * ("incline bench" must hit Upper Chest before the plain chest test does).
 */
export function inferMuscleGroup(exercise: unknown): string {
  const name = String(exercise).trim();
  if (name in MUSCLE_MAP) {
    return MUSCLE_MAP[name];
  }

  const lower = name.toLowerCase();

  if (includesAny(lower, UPPER_CHEST_HINTS) && includesAny(lower, UPPER_CHEST_CONFIRM)) {
    return 'Upper Chest';
  }
  if (includesAny(lower, CHEST)) return 'Chest';
  if (includesAny(lower, SIDE_DELTS)) return 'Side Delts';
  if (includesAny(lower, REAR_DELTS)) return 'Rear Delts';
  if (includesAny(lower, BACK_WIDTH)) return 'Back Width';
  if (includesAny(lower, BACK_THICKNESS)) return 'Back Thickness';
  if (includesAny(lower, BICEPS)) {
    return includesAny(lower, FOREARM_OVERRIDES) ? 'Forearms' : 'Biceps';
  }
  if (includesAny(lower, TRICEPS)) return 'Triceps';
  if (includesAny(lower, QUADS)) return 'Quads';
  if (includesAny(lower, HAMSTRINGS)) return 'Hamstrings';
  if (lower.includes('calf')) return 'Calves';
  if (includesAny(lower, ADDUCTORS)) return 'Adductors';
  if (includesAny(lower, GLUTES)) return 'Glutes';
  if (includesAny(lower, ABS)) return 'Abs';
  return 'Other';
}
