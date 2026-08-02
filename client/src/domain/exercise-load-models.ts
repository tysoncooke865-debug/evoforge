/**
 * THE CANONICAL LOAD MODEL OF AN EXERCISE.
 *
 * The exercise definition decides what a movement means, NOT a UI component
 * matching on a name. Everything that needs to know whether a pull-up admits
 * added weight calls `loadModelFor()`; nothing greps for "pull" in a screen.
 *
 * Resolution order, most specific first:
 *   1. An explicit `loadModel` on the athlete's own custom exercise.
 *   2. The curated map below, keyed on canonical library names.
 *   3. A pattern pass over the movement's base name, so the ~960-entry
 *      imported corpus (and its variants: "Wide-Grip Pull-Up", "Ring Dip")
 *      inherits a sane model without 960 hand-written rows.
 *   4. Equipment: anything tagged Bodyweight that we still cannot place is
 *      `bodyweight`; everything else is `external_load`.
 *
 * Step 3 is pattern matching over EXERCISE DATA, which is what this module
 * is for. That is a different thing from a screen deciding behaviour by
 * name — the rule lives once, here, and is unit-tested.
 */

import type { LibraryExercise } from './exercise-taxonomy';

export type ExerciseLoadModel =
  | 'external_load'
  | 'bodyweight'
  | 'bodyweight_weighted'
  | 'bodyweight_assisted'
  | 'bodyweight_weighted_or_assisted'
  | 'repetition_only'
  | 'duration'
  | 'distance';

/**
 * Does this movement's effective resistance belong in lifted tonnage?
 *
 * FALSE for push-ups, planks and air squats. A push-up does not move ~100%
 * of bodyweight (it is roughly 60-70%, and it varies with limb length and
 * foot elevation), so adding a full 76 kg per rep would swamp an athlete's
 * tonnage with a number that is simply wrong. The brief's instruction is to
 * avoid invented precision rather than to invent a coefficient: these
 * movements progress on reps, duration and variation instead.
 *
 * TRUE for pull-ups, chin-ups and dips, where the athlete genuinely supports
 * close to their whole bodyweight and the brief permits full-bodyweight
 * effective resistance.
 */
export interface LoadModelMeta {
  model: ExerciseLoadModel;
  contributesToTonnage: boolean;
}

const M = (model: ExerciseLoadModel, contributesToTonnage: boolean): LoadModelMeta => ({
  model,
  contributesToTonnage,
});

/** Canonical library names (exact, lowercased at lookup). */
const EXPLICIT: Record<string, LoadModelMeta> = {
  'pull-up': M('bodyweight_weighted_or_assisted', true),
  'weighted pull-up': M('bodyweight_weighted_or_assisted', true),
  'assisted pull-up': M('bodyweight_assisted', true),
  'chin-up': M('bodyweight_weighted_or_assisted', true),
  'weighted chin-up': M('bodyweight_weighted_or_assisted', true),
  'assisted chin-up': M('bodyweight_assisted', true),
  dip: M('bodyweight_weighted_or_assisted', true),
  'chest dip': M('bodyweight_weighted_or_assisted', true),
  'weighted chest dip': M('bodyweight_weighted_or_assisted', true),
  'tricep dip': M('bodyweight_weighted_or_assisted', true),
  'assisted dip': M('bodyweight_assisted', true),
  'muscle-up': M('bodyweight_weighted_or_assisted', true),
  'inverted row': M('bodyweight_weighted', true),

  // Not full bodyweight, and we refuse to guess a coefficient.
  'push-up': M('bodyweight', false),
  'decline push-up': M('bodyweight', false),
  'incline push-up': M('bodyweight', false),
  'diamond push-up': M('bodyweight', false),
  'air squat': M('repetition_only', false),
  'bodyweight squat': M('repetition_only', false),
  burpee: M('repetition_only', false),
  'walking lunge': M('repetition_only', false),
  'mountain climber': M('repetition_only', false),
  'sit-up': M('repetition_only', false),
  crunch: M('repetition_only', false),

  plank: M('duration', false),
  'side plank': M('duration', false),
  'dead hang': M('duration', false),
  'wall sit': M('duration', false),
  'hollow hold': M('duration', false),
  'farmer’s walk': M('external_load', true),
};

/** Patterns over the base name, applied in order. */
const PATTERNS: { re: RegExp; meta: LoadModelMeta }[] = [
  { re: /\b(plank|dead ?hang|wall sit|hollow hold|l-sit|static hold)\b/i, meta: M('duration', false) },
  { re: /\bassisted\b.*\b(pull|chin|dip|muscle)/i, meta: M('bodyweight_assisted', true) },
  { re: /\b(pull-?up|chin-?up|dip|muscle-?up)s?\b/i, meta: M('bodyweight_weighted_or_assisted', true) },
  { re: /\b(push-?up|press-?up)s?\b/i, meta: M('bodyweight', false) },
  { re: /\b(air squat|bodyweight squat|burpee|lunge|mountain climber|sit-?up|crunch|jumping jack)s?\b/i, meta: M('repetition_only', false) },
  { re: /\b(inverted row|australian row)s?\b/i, meta: M('bodyweight_weighted', true) },
];

/** Strip the qualifiers that do not change the load model. */
function baseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\((.*?)\)/g, ' ')
    .replace(/\b(wide|close|narrow|neutral|reverse|mixed|ring|parallel|bar|band|strict|paused|slow|tempo|eccentric)[- ]?grip\b/g, ' ')
    .replace(/\b(wide|close|narrow|neutral|ring|parallel|strict|paused|explosive|deficit|elevated|feet[- ]elevated)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExerciseLoadMeta extends LoadModelMeta {
  /** Where the answer came from — surfaced in tests and the review UI so an
   *  unexpected model is traceable rather than mysterious. */
  source: 'custom' | 'explicit' | 'pattern' | 'equipment';
}

/**
 * Resolve an exercise's load model.
 *
 * `library` and `custom` are passed in rather than imported so this stays a
 * pure function — the callers already hold both (the same way muscle
 * resolution threads `userExercises` through `useSaveSet`).
 */
export function loadModelFor(
  exerciseName: string,
  opts: {
    library?: Pick<LibraryExercise, 'name' | 'equipment'> & { loadModel?: ExerciseLoadModel } | null;
    customLoadModel?: ExerciseLoadModel | null;
  } = {}
): ExerciseLoadMeta {
  if (opts.customLoadModel) {
    return { model: opts.customLoadModel, contributesToTonnage: tonnageDefault(opts.customLoadModel), source: 'custom' };
  }
  if (opts.library?.loadModel) {
    return { model: opts.library.loadModel, contributesToTonnage: tonnageDefault(opts.library.loadModel), source: 'custom' };
  }

  const name = String(exerciseName ?? '').toLowerCase().trim();
  const base = baseName(name);

  const explicit = EXPLICIT[name] ?? EXPLICIT[base];
  if (explicit) return { ...explicit, source: 'explicit' };

  for (const p of PATTERNS) {
    if (p.re.test(base) || p.re.test(name)) return { ...p.meta, source: 'pattern' };
  }

  if (opts.library?.equipment === 'Bodyweight') {
    return { model: 'bodyweight', contributesToTonnage: false, source: 'equipment' };
  }
  return { model: 'external_load', contributesToTonnage: true, source: 'equipment' };
}

/** Tonnage default for a model with no explicit entry. Conservative: only
 *  ordinary external load counts unless a curated row says otherwise. */
function tonnageDefault(model: ExerciseLoadModel): boolean {
  return model === 'external_load';
}

/** Convenience: does this exercise's resistance belong in tonnage? */
export function contributesToTonnage(exerciseName: string, opts?: Parameters<typeof loadModelFor>[1]): boolean {
  return loadModelFor(exerciseName, opts).contributesToTonnage;
}
