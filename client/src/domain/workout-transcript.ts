/**
 * WORKOUT TRANSCRIPTION — untrusted input, canonical output.
 *
 * TWO HALVES, and the split is the point:
 *
 *   `validateParsedSet()` treats ANY extraction as hostile. It is what an AI
 *   model's JSON must survive before it can reach the review screen, let
 *   alone the database. Unknown load modes, assistance stored as positive
 *   weight, a "bodyweight" set carrying 20 kg, a load mode the exercise does
 *   not support — all rejected here, by the same rules manual entry obeys
 *   (exercise-load.ts). There is no second set model and no second rulebook.
 *
 *   `parseTranscript()` is a DETERMINISTIC parser for the phrasings athletes
 *   actually use. It exists because the alternative — asking a model to do
 *   arithmetic on kilograms — is exactly the failure this whole fix is
 *   cleaning up. Everything it returns is reproducible, testable and
 *   explainable, and it doubles as the oracle a future AI extractor is
 *   graded against.
 *
 * AMBIGUITY IS PRESERVED, NEVER GUESSED. "Pull-ups, 20 kilos for 8" could be
 * added weight, assistance, or a mis-stated total. It comes back with
 * `loadMode: null`, low confidence and a warning, and the review screen makes
 * the athlete choose. The one thing we will not do is quietly call it
 * ordinary external weight — that is how `30 kg x 10` came to mean an
 * athlete lifting thirty kilograms on a machine that was HELPING them.
 */

import {
  type AssistanceType,
  type CanonicalSet,
  type ExerciseLoadMode,
  fromDisplayWeight,
  modeIsAllowed,
  normaliseExerciseSet,
  validateExerciseSet,
} from './exercise-load';
import { type ExerciseLoadModel, loadModelFor } from './exercise-load-models';

export interface ParsedWorkoutSet {
  exerciseName: string;
  matchedExerciseId: string | null;
  /** NULL means genuinely undecided — the review screen must resolve it. */
  loadMode: ExerciseLoadMode | null;
  weightKg: number | null;
  externalLoadKg: number | null;
  assistanceKg: number | null;
  assistanceType: AssistanceType | null;
  assistanceDescription: string | null;
  reps: number | null;
  repsPerSide: boolean | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** 0..1. <0.5 forces the athlete to choose before the set can save. */
  confidence: number;
  warnings: string[];
  /** Performance notes we deliberately do not model (tempo, "strict"). */
  notes?: string | null;
}

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
  /** Present only when `ok` — the set, normalised against the exercise. */
  set: CanonicalSet | null;
  /** True when the athlete MUST resolve something before this can save. */
  requiresReview: boolean;
}

const CONFIDENCE = { high: 0.9, medium: 0.6, low: 0.3 } as const;
const REVIEW_THRESHOLD = 0.5;

const KNOWN_MODES: ExerciseLoadMode[] = [
  'external',
  'bodyweight',
  'weighted_bodyweight',
  'assisted_bodyweight',
  'repetition_only',
  'duration',
  'distance',
];

/**
 * The gate every extraction passes through. Nothing reaches the canonical
 * save service without returning `ok` from here.
 */
export function validateParsedSet(
  parsed: ParsedWorkoutSet,
  model?: ExerciseLoadModel
): ValidationOutcome {
  const errors: string[] = [];
  const loadModel = model ?? loadModelFor(parsed.exerciseName).model;

  if (!parsed.exerciseName || typeof parsed.exerciseName !== 'string') errors.push('missing_exercise_name');

  if (parsed.loadMode !== null && !KNOWN_MODES.includes(parsed.loadMode)) {
    // An unsupported mode is a MODEL error, not a user error: fail loudly
    // rather than coercing it into something plausible.
    errors.push('unsupported_load_mode');
  }

  // THESE CHECKS RUN ON THE RAW EXTRACTION, BEFORE NORMALISATION, and that
  // ordering is the whole point. `normaliseExerciseSet` sanitises — it clears
  // fields a mode does not allow — which is exactly right for a human
  // flipping a segmented control, and exactly wrong for a model's output: it
  // would silently "fix" a set that says `bodyweight` while carrying 20 kg
  // and report success. An extractor that contradicts itself must be
  // REJECTED, because we cannot tell which half it got right.
  if (parsed.assistanceKg != null && parsed.assistanceKg < 0) errors.push('negative_assistance');
  if (parsed.externalLoadKg != null && parsed.externalLoadKg < 0) errors.push('negative_added_weight');
  if (parsed.externalLoadKg != null && parsed.assistanceKg != null) errors.push('added_and_assistance_together');
  if (parsed.loadMode === 'assisted_bodyweight' && parsed.weightKg != null) {
    errors.push('assistance_stored_as_external_weight');
  }
  if (parsed.loadMode === 'bodyweight') {
    if (parsed.externalLoadKg != null) errors.push('bodyweight_with_added_weight');
    if (parsed.assistanceKg != null) errors.push('bodyweight_with_assistance');
    if (parsed.weightKg != null) errors.push('bodyweight_with_added_weight');
  }
  if (parsed.loadMode === 'repetition_only' &&
      (parsed.externalLoadKg != null || parsed.assistanceKg != null || parsed.weightKg != null)) {
    errors.push('load_on_repetition_only');
  }

  const requiresReview =
    parsed.loadMode === null ||
    parsed.confidence < REVIEW_THRESHOLD ||
    !modeIsAllowed(loadModel, parsed.loadMode);

  if (errors.length > 0) return { ok: false, errors, set: null, requiresReview: true };
  if (parsed.loadMode === null) return { ok: false, errors: ['load_mode_unresolved'], set: null, requiresReview: true };

  const candidate = normaliseExerciseSet(
    {
      loadMode: parsed.loadMode,
      weightKg: parsed.weightKg,
      externalLoadKg: parsed.externalLoadKg,
      assistanceKg: parsed.assistanceKg,
      assistanceType: parsed.assistanceType,
      assistanceDescription: parsed.assistanceDescription,
      reps: parsed.reps,
      repsPerSide: parsed.repsPerSide,
      durationSeconds: parsed.durationSeconds,
      distanceMeters: parsed.distanceMeters,
    },
    loadModel
  );

  const v = validateExerciseSet(candidate, loadModel);
  return {
    ok: v.ok,
    errors: v.errors,
    set: v.ok ? candidate : null,
    requiresReview: requiresReview || !v.ok,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic phrase parsing                                        */
/* ------------------------------------------------------------------ */

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const numberOf = (t: string): number | null => {
  const w = WORD_NUM[t.toLowerCase()];
  if (w != null) return w;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** "20 kilos", "25 pounds", "10-kilo", "20kg" -> kilograms. */
function weightIn(text: string): { kg: number; raw: number; unit: 'kg' | 'lb' } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*-?\s*(kilograms?|kilos?|kgs?|kg|pounds?|lbs?|lb)\b/i);
  if (!m) return null;
  const raw = Number(m[1]);
  const unit: 'kg' | 'lb' = /^(p|l)/i.test(m[2]) ? 'lb' : 'kg';
  return { kg: Math.round(fromDisplayWeight(raw, unit) * 100) / 100, raw, unit };
}

/** "for 60 seconds", "45-second", "one minute" -> seconds. */
function durationIn(text: string): number | null {
  const min = text.match(/(\d+(?:\.\d+)?|one|two|three)\s*-?\s*(minutes?|mins?)\b/i);
  if (min) {
    const v = numberOf(min[1]);
    if (v != null) return v * 60;
  }
  const sec = text.match(/(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s)\b/i);
  if (sec) return Number(sec[1]);
  return null;
}

const ASSIST_WORDS = /\b(assist(ed|ance)?|machine[- ]assisted|with (?:a |an )?band|band[- ]assisted|counterweight)\b/i;
const ADDED_WORDS = /\b(plus|added|adding|weighted|with a (?:\d+\s*-?\s*)?(?:kilo|kg|pound|lb)?\s*plate|extra)\b/i;
const BODYWEIGHT_WORDS = /\b(bodyweight|body weight|b\.?w\.?|unassisted|just bodyweight|no weight)\b/i;
const PER_SIDE = /\b(each|per)\s+(side|leg|arm|hand)\b/i;
const TEMPO_NOTES = /\b(strict|paused?|slow negative|tempo|explosive|controlled)\b/i;

/**
 * How many sets the sentence declares, or null for "just one".
 *
 * Only two shapes count, and both are explicit: "N sets", and a leading
 * count in front of a duration phrase ("Three 45-second side planks"). Any
 * looser rule reads a rep count or a load as a set count.
 */
function setCountIn(text: string): number | null {
  const explicit = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+sets?\b/i);
  if (explicit) return numberOf(explicit[1]) ?? null;
  const leading = text.match(/^\s*(one|two|three|four|five|six|\d{1,2})\s+\d+\s*-?\s*(second|sec|minute|min)/i);
  if (leading) return numberOf(leading[1]) ?? null;
  return null;
}

/** Split a line into its rep list: "10, 9, 8, 7" / "20, 18 and 15". */
function repList(text: string): number[] {
  const tail = text.replace(/^[^:]*:/, '');
  const nums = tail.match(/\b\d{1,3}\b/g);
  if (!nums) return [];
  return nums.map(Number).filter((n) => n > 0 && n <= 200);
}

function exerciseNameIn(text: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\bside planks?\b/i, 'Side Plank'],
    [/\bplanks?\b/i, 'Plank'],
    [/\bdead ?hangs?\b/i, 'Dead Hang'],
    [/\bchin-?ups?\b/i, 'Chin-Up'],
    [/\bpull-?ups?\b/i, 'Pull-Up'],
    [/\bmuscle-?ups?\b/i, 'Muscle-Up'],
    [/\bdips?\b/i, 'Dip'],
    [/\bpush-?ups?\b|\bpress-?ups?\b/i, 'Push-Up'],
    [/\bair squats?\b|\bbodyweight squats?\b/i, 'Air Squat'],
    [/\bwalking lunges?\b|\blunges?\b/i, 'Walking Lunge'],
    [/\bburpees?\b/i, 'Burpee'],
    [/\bbench press(es)?\b/i, 'Barbell Bench Press'],
    [/\blat pulldowns?\b/i, 'Lat Pulldown'],
  ];
  for (const [re, name] of patterns) if (re.test(text)) return name;
  return null;
}

/**
 * Parse one spoken/typed line into zero or more sets.
 *
 * Every returned set is a CANDIDATE. Nothing here writes anything; the
 * caller runs `validateParsedSet` and shows the review screen.
 */
export function parseTranscriptLine(line: string): ParsedWorkoutSet[] {
  const text = String(line ?? '').trim();
  if (!text) return [];

  const exerciseName = exerciseNameIn(text);
  if (!exerciseName) return [];

  const model = loadModelFor(exerciseName).model;
  const warnings: string[] = [];
  const notes = TEMPO_NOTES.test(text) ? (text.match(TEMPO_NOTES)?.[0] ?? null) : null;
  const perSide = PER_SIDE.test(text) ? true : null;

  // ---- duration movements ------------------------------------------------
  if (model === 'duration') {
    const seconds = durationIn(text);
    // TIGHT ON PURPOSE. A loose count pattern read the 60 in "Plank for 60
    // seconds" as a SET COUNT and returned sixty planks. A count is only a
    // count when the sentence says "N sets", or when it leads a phrase like
    // "Three 45-second side planks".
    const count = setCountIn(text) ?? 1;
    if (seconds == null) return [];
    return Array.from({ length: count }, () => ({
      exerciseName, matchedExerciseId: null, loadMode: 'duration' as const,
      weightKg: null, externalLoadKg: null, assistanceKg: null,
      assistanceType: null, assistanceDescription: null,
      reps: null, repsPerSide: perSide, durationSeconds: seconds, distanceMeters: null,
      confidence: CONFIDENCE.high, warnings, notes,
    }));
  }

  const w = weightIn(text);
  const assisted = ASSIST_WORDS.test(text);
  const added = ADDED_WORDS.test(text);
  const bodyweightSaid = BODYWEIGHT_WORDS.test(text);
  const band = /\bband\b/i.test(text);

  let loadMode: ExerciseLoadMode | null;
  let externalLoadKg: number | null = null;
  let assistanceKg: number | null = null;
  let assistanceType: AssistanceType | null = null;
  let assistanceDescription: string | null = null;
  let confidence: number = CONFIDENCE.high;

  if (assisted) {
    loadMode = 'assisted_bodyweight';
    if (band) {
      // NEVER invent a kilogram value for a band.
      assistanceType = 'band';
      assistanceDescription = text.match(/\b(\w+\s+)?resistance band\b/i)?.[0] ?? 'band';
      warnings.push('band_assistance_has_no_kilogram_value');
    } else {
      assistanceType = 'machine';
      assistanceKg = w?.kg ?? null;
      if (assistanceKg == null) {
        confidence = CONFIDENCE.medium;
        warnings.push('assistance_amount_missing');
      }
    }
  } else if (added && w) {
    loadMode = 'weighted_bodyweight';
    externalLoadKg = w.kg;
  } else if (bodyweightSaid || !w) {
    loadMode = model === 'repetition_only' ? 'repetition_only' : 'bodyweight';
    if (model === 'external_load') loadMode = 'external';
  } else {
    // A load with NO qualifying word on a bodyweight-family movement.
    // "Pull-ups, 20 kilos for 8" — added, assistance or a mis-stated total.
    // Refuse to decide.
    if (model === 'external_load') {
      loadMode = 'external';
    } else {
      loadMode = null;
      confidence = CONFIDENCE.low;
      warnings.push('ambiguous_load_meaning');
    }
  }

  // ---- reps --------------------------------------------------------------
  const explicitList = /[:,]\s*\d+(?:\s*,\s*\d+)+|\d+\s*,\s*\d+\s+and\s+\d+/.test(text);
  let repsPerSet: number[];
  if (explicitList) {
    const all = repList(text);
    // Drop a leading load number that is not a rep count.
    repsPerSet = w ? all.filter((n) => n !== w.raw) : all;
  } else {
    const forM = text.match(/\bfor\s+(\d+)\b/i);
    const repsM = text.match(/\b(\d+)\s*reps?\b/i);
    const ofM = text.match(/\bsets?\s+of\s+(\d+)\b/i);
    // "12 each leg" — a bare count qualified by a per-side phrase.
    const perSideM = text.match(/\b(\d+)\s+(?:each|per)\b/i);
    const leading = text.match(/^\s*(\d+)\s+\w/);
    const reps =
      Number(forM?.[1]) || Number(repsM?.[1]) || Number(ofM?.[1]) ||
      Number(perSideM?.[1]) || Number(leading?.[1]) || null;
    const count = setCountIn(text) ?? 1;
    repsPerSet = reps ? Array.from({ length: count }, () => reps) : [];
  }
  if (repsPerSet.length === 0) return [];

  return repsPerSet.map((reps) => ({
    exerciseName,
    matchedExerciseId: null,
    loadMode,
    weightKg: loadMode === 'external' ? (w?.kg ?? null) : null,
    externalLoadKg,
    assistanceKg,
    assistanceType,
    assistanceDescription,
    reps,
    repsPerSide: perSide,
    durationSeconds: null,
    distanceMeters: null,
    confidence,
    warnings: [...warnings],
    notes,
  }));
}

/** Whole transcript: one or many exercises, line- or sentence-separated. */
export function parseTranscript(transcript: string): ParsedWorkoutSet[] {
  return String(transcript ?? '')
    .split(/[\n.;]+/)
    .flatMap((line) => parseTranscriptLine(line));
}

/** The review screen's question for an unresolved set. */
export function ambiguityPrompt(parsed: ParsedWorkoutSet, unitAmount: string): string {
  return `${parsed.exerciseName.toUpperCase()} — ${parsed.reps} REPS\n\nHow was ${unitAmount} used?`;
}
