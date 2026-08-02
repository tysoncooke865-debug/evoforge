/**
 * EXERCISE LOAD — the canonical meaning of a logged set.
 *
 * THE BUG THIS EXISTS TO FIX. `workout_log` carried one `weight` column, so
 * four completely different sets collapsed into one ambiguous number:
 *
 *     pull-up, bodyweight        -> 0 kg  x 12   (reads as "no resistance")
 *     pull-up, bodyweight        -> 76 kg x 12   (athlete typed their weight)
 *     pull-up, +20 kg            -> 96 kg x 8    (bodyweight + added, merged)
 *     pull-up, 30 kg assistance  -> 30 kg x 10   (assistance stored as LOAD)
 *
 * The consequences were not cosmetic. A bodyweight set has e1RM 0, so it can
 * never set a record. An assisted set records assistance as weight LIFTED, so
 * an athlete who lowers their assistance — the entire point of the machine —
 * reads as getting weaker. A weighted pull-up entered as a total inflates
 * tonnage and e1RM against every other back movement.
 *
 * So a set now stores its MODE and its PARTS, never a pre-computed total.
 * Effective resistance is derived when it is needed and is never what the
 * athlete reads: they see `BW + 20 kg x 8`, because that is what they did.
 *
 * THIS MODULE IS THE ONLY PLACE THESE RULES LIVE. The active-workout keypad,
 * set history, personal records, the AI transcript parser, its review screen
 * and the import flow all call these functions. No screen decides what a
 * pull-up means by matching its name — `loadModelFor()` reads the canonical
 * exercise metadata (see exercise-load-models.ts).
 */

import type { ExerciseLoadModel } from './exercise-load-models';

export type { ExerciseLoadModel };

/**
 * What a PARTICULAR SET was. The model says what an exercise permits; the
 * mode says what the athlete actually did this time.
 */
export type ExerciseLoadMode =
  | 'external'
  | 'bodyweight'
  | 'weighted_bodyweight'
  | 'assisted_bodyweight'
  | 'repetition_only'
  | 'duration'
  | 'distance';

export type AssistanceType = 'machine' | 'band' | 'partner' | 'other';

/**
 * The canonical set. Manual entry, AI transcription and import all produce
 * THIS — there is no second shape anywhere (the brief's "do not create
 * parallel manual-entry and AI-transcription set models").
 */
export interface CanonicalSet {
  loadMode: ExerciseLoadMode;
  /** External bar/stack load for `external` sets. Null for every other mode. */
  weightKg: number | null;
  /** ADDED load on a weighted bodyweight set. Never bodyweight + added. */
  externalLoadKg: number | null;
  /** Assistance REMOVED on an assisted set. Always stored positive, and
   *  never as ordinary external weight. */
  assistanceKg: number | null;
  assistanceType: AssistanceType | null;
  /** Free text for assistance that has no honest kilogram value — a band.
   *  We never invent a number for one. */
  assistanceDescription: string | null;
  /** The athlete's bodyweight WHEN THE SET WAS SAVED. Frozen forever after;
   *  null when unknown, which is allowed and must never block logging. */
  bodyweightSnapshotKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** "12 each side" — preserved, never silently doubled. */
  repsPerSide?: boolean | null;
}

/* ------------------------------------------------------------------ */
/* Bounds — configuration, not magic numbers scattered at call sites   */
/* ------------------------------------------------------------------ */

export const LOAD_BOUNDS = {
  maxExternalKg: 700,
  maxAddedKg: 200,
  maxAssistanceKg: 200,
  maxReps: 500,
  maxDurationSeconds: 60 * 60 * 6,
  maxDistanceMeters: 200_000,
  maxBodyweightKg: 400,
} as const;

/* ------------------------------------------------------------------ */
/* Which modes an exercise permits                                     */
/* ------------------------------------------------------------------ */

export function modesForModel(model: ExerciseLoadModel): ExerciseLoadMode[] {
  switch (model) {
    case 'external_load':
      return ['external'];
    case 'bodyweight':
      return ['bodyweight'];
    case 'bodyweight_weighted':
      return ['bodyweight', 'weighted_bodyweight'];
    case 'bodyweight_assisted':
      return ['bodyweight', 'assisted_bodyweight'];
    case 'bodyweight_weighted_or_assisted':
      return ['bodyweight', 'weighted_bodyweight', 'assisted_bodyweight'];
    case 'repetition_only':
      return ['repetition_only'];
    case 'duration':
      return ['duration'];
    case 'distance':
      return ['distance'];
  }
}

export function defaultModeForModel(model: ExerciseLoadModel): ExerciseLoadMode {
  return modesForModel(model)[0];
}

export function modeIsAllowed(model: ExerciseLoadModel, mode: ExerciseLoadMode): boolean {
  return modesForModel(model).includes(mode);
}

/** Does this mode involve the athlete's own bodyweight at all? */
export function isBodyweightMode(mode: ExerciseLoadMode): boolean {
  return mode === 'bodyweight' || mode === 'weighted_bodyweight' || mode === 'assisted_bodyweight';
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  ok: boolean;
  /** Stable codes, so a UI can localise and a test can assert. */
  errors: string[];
}

/**
 * Refuse the combinations that would put a lie in the database.
 *
 * Deliberately strict about the two that caused the original bug: a
 * bodyweight set carrying a load, and a set carrying BOTH added weight and
 * assistance (which is not a thing you can physically do).
 */
export function validateExerciseSet(set: CanonicalSet, model: ExerciseLoadModel): ValidationResult {
  const errors: string[] = [];
  const { loadMode: mode } = set;

  if (!modeIsAllowed(model, mode)) errors.push('mode_not_supported_by_exercise');

  const added = set.externalLoadKg;
  const assist = set.assistanceKg;

  if (added != null && added < 0) errors.push('negative_added_weight');
  if (assist != null && assist < 0) errors.push('negative_assistance');
  if (added != null && assist != null) errors.push('added_and_assistance_together');
  if (added != null && added > LOAD_BOUNDS.maxAddedKg) errors.push('added_weight_out_of_range');
  if (assist != null && assist > LOAD_BOUNDS.maxAssistanceKg) errors.push('assistance_out_of_range');

  switch (mode) {
    case 'bodyweight':
      if (added != null) errors.push('bodyweight_with_added_weight');
      if (assist != null) errors.push('bodyweight_with_assistance');
      if (!(set.reps && set.reps > 0)) errors.push('reps_required');
      break;
    case 'weighted_bodyweight':
      if (added == null) errors.push('added_weight_required');
      if (!(set.reps && set.reps > 0)) errors.push('reps_required');
      break;
    case 'assisted_bodyweight':
      // A BAND has no honest kilogram value. An assisted set is therefore
      // valid with a description and no number — the alternative is inventing
      // resistance, which the brief forbids outright.
      if (assist == null && set.assistanceType !== 'band' && !set.assistanceDescription) {
        errors.push('assistance_required');
      }
      if (!(set.reps && set.reps > 0)) errors.push('reps_required');
      break;
    case 'external':
      if (set.weightKg == null || set.weightKg < 0) errors.push('weight_required');
      if (set.weightKg != null && set.weightKg > LOAD_BOUNDS.maxExternalKg) errors.push('weight_out_of_range');
      if (!(set.reps && set.reps > 0)) errors.push('reps_required');
      break;
    case 'repetition_only':
      if (!(set.reps && set.reps > 0)) errors.push('reps_required');
      if (added != null || assist != null || set.weightKg != null) errors.push('load_on_repetition_only');
      break;
    case 'duration':
      if (!(set.durationSeconds && set.durationSeconds > 0)) errors.push('duration_required');
      if (set.durationSeconds != null && set.durationSeconds > LOAD_BOUNDS.maxDurationSeconds) {
        errors.push('duration_out_of_range');
      }
      break;
    case 'distance':
      if (!(set.distanceMeters && set.distanceMeters > 0)) errors.push('distance_required');
      if (set.distanceMeters != null && set.distanceMeters > LOAD_BOUNDS.maxDistanceMeters) {
        errors.push('distance_out_of_range');
      }
      break;
  }

  if (set.reps != null && set.reps > LOAD_BOUNDS.maxReps) errors.push('reps_out_of_range');

  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const EMPTY: CanonicalSet = {
  loadMode: 'external',
  weightKg: null,
  externalLoadKg: null,
  assistanceKg: null,
  assistanceType: null,
  assistanceDescription: null,
  bodyweightSnapshotKg: null,
  reps: null,
  durationSeconds: null,
  distanceMeters: null,
  repsPerSide: null,
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Force a partial/untrusted set into the shape its mode allows.
 *
 * The AI parser, the import flow and an edited manual set all go through
 * here, so a field that does not belong to a mode is CLEARED rather than
 * quietly persisted — that is what stops an assisted set from keeping a
 * stale added-weight value when the athlete flips the segmented control.
 */
export function normaliseExerciseSet(
  input: Partial<CanonicalSet>,
  model: ExerciseLoadModel
): CanonicalSet {
  const mode: ExerciseLoadMode = modeIsAllowed(model, input.loadMode as ExerciseLoadMode)
    ? (input.loadMode as ExerciseLoadMode)
    : defaultModeForModel(model);

  const out: CanonicalSet = {
    ...EMPTY,
    loadMode: mode,
    reps: num(input.reps),
    repsPerSide: input.repsPerSide ?? null,
    bodyweightSnapshotKg: num(input.bodyweightSnapshotKg),
  };

  switch (mode) {
    case 'external':
      out.weightKg = num(input.weightKg) ?? num(input.externalLoadKg);
      break;
    case 'weighted_bodyweight':
      out.externalLoadKg = num(input.externalLoadKg) ?? num(input.weightKg);
      break;
    case 'assisted_bodyweight':
      out.assistanceKg = num(input.assistanceKg);
      out.assistanceType = input.assistanceType ?? null;
      out.assistanceDescription = input.assistanceDescription ?? null;
      break;
    case 'duration':
      out.durationSeconds = num(input.durationSeconds);
      break;
    case 'distance':
      out.distanceMeters = num(input.distanceMeters);
      break;
    case 'bodyweight':
    case 'repetition_only':
      break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Effective resistance                                                */
/* ------------------------------------------------------------------ */

/**
 * What the athlete actually moved, in kg — or NULL when we genuinely do not
 * know.
 *
 * Null is a real answer and callers must handle it: a bodyweight set logged
 * by someone who has never recorded a weigh-in has no honest resistance, and
 * the brief is explicit that we do not invent one. Excluding it from a
 * calculation is correct; substituting a guess is not.
 */
export function calculateEffectiveResistanceKg(set: CanonicalSet): number | null {
  switch (set.loadMode) {
    case 'external':
      return set.weightKg ?? null;
    case 'bodyweight':
      return set.bodyweightSnapshotKg ?? null;
    case 'weighted_bodyweight': {
      const bw = set.bodyweightSnapshotKg;
      const added = set.externalLoadKg ?? 0;
      return bw == null ? null : bw + added;
    }
    case 'assisted_bodyweight': {
      const bw = set.bodyweightSnapshotKg;
      // A band with no kilogram value cannot produce a number. Saying so is
      // the honest answer.
      if (bw == null || set.assistanceKg == null) return null;
      // Assistance can never make a set negative resistance.
      return Math.max(0, bw - set.assistanceKg);
    }
    case 'repetition_only':
    case 'duration':
    case 'distance':
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Formatting — ONE vocabulary for every surface                       */
/* ------------------------------------------------------------------ */

export type WeightUnit = 'kg' | 'lb';

const KG_PER_LB = 0.45359237;

export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  const v = unit === 'lb' ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value * KG_PER_LB : value;
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** "1m 30s" for anything over a minute, "45 sec" below it. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

/**
 * The canonical set description. Every surface renders sets through this —
 * history, previous-set, the summary sheet, the transcript review screen —
 * so `BW + 20 kg x 8` reads identically everywhere and can never regress to
 * a computed total in one place and not another.
 */
export function formatExerciseSet(set: CanonicalSet, unit: WeightUnit = 'kg'): string {
  const u = unit;
  const w = (kg: number) => `${trim(toDisplayWeight(kg, u))} ${u}`;
  const reps = set.reps ?? 0;
  const perSide = set.repsPerSide ? ' each side' : '';

  switch (set.loadMode) {
    case 'bodyweight':
      return `BW × ${reps}${perSide}`;
    case 'weighted_bodyweight':
      return set.externalLoadKg == null
        ? `BW × ${reps}${perSide}`
        : `BW + ${w(set.externalLoadKg)} × ${reps}${perSide}`;
    case 'assisted_bodyweight':
      if (set.assistanceKg != null) return `BW − ${w(set.assistanceKg)} × ${reps}${perSide}`;
      // Band assistance: say which band, never a fabricated number.
      return `BW − ${set.assistanceDescription ?? 'assisted'} × ${reps}${perSide}`;
    case 'repetition_only':
      return `${reps} reps${perSide}`;
    case 'duration':
      return set.durationSeconds == null ? '—' : formatDuration(set.durationSeconds);
    case 'distance':
      return set.distanceMeters == null ? '—' : `${trim(set.distanceMeters)} m`;
    case 'external':
      return set.weightKg == null ? `${reps} reps${perSide}` : `${w(set.weightKg)} × ${reps}${perSide}`;
  }
}

/** The keypad's label for the load field in each mode. */
export function loadFieldLabel(mode: ExerciseLoadMode): string | null {
  switch (mode) {
    case 'weighted_bodyweight':
      return 'Added weight';
    case 'assisted_bodyweight':
      return 'Assistance';
    case 'external':
      return 'Weight';
    default:
      return null;
  }
}

/** The sign shown beside the load field. Text, never colour alone. */
export function loadFieldSign(mode: ExerciseLoadMode): '+' | '−' | null {
  if (mode === 'weighted_bodyweight') return '+';
  if (mode === 'assisted_bodyweight') return '−';
  return null;
}

export const MODE_LABEL: Record<ExerciseLoadMode, string> = {
  external: 'WEIGHT',
  bodyweight: 'BODYWEIGHT',
  weighted_bodyweight: 'WEIGHTED',
  assisted_bodyweight: 'ASSISTED',
  repetition_only: 'REPS',
  duration: 'TIME',
  distance: 'DISTANCE',
};

/* ------------------------------------------------------------------ */
/* Copying a previous set                                              */
/* ------------------------------------------------------------------ */

/**
 * Seed a new set from a previous one.
 *
 * Carries the MODE and the PARTS — copying a weighted pull-up gives you the
 * added 20 kg, never the 96 kg effective total. Deliberately DROPS the
 * bodyweight snapshot: the new set takes a fresh one when it saves, because
 * a snapshot is a record of a moment and copying it forward would forge one.
 */
export function copyPreviousSet(previous: CanonicalSet): CanonicalSet {
  return { ...previous, bodyweightSnapshotKg: null };
}
