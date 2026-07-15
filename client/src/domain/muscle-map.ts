/**
 * MUSCLE MAP — the pure contract (Tyson's spec, 2026-07-15): the 15 muscle
 * regions the neon overlay system can light, and the normalisation from
 * whatever a row, plan entry or dataset calls a muscle into those ids.
 *
 * Pure on purpose (no react, no svg): the ui/muscle-map components render
 * over this vocabulary, and the tests drive it without a renderer. An
 * unknown label maps to null and lights NOTHING — honest beats wrong, the
 * same rule the hero pills follow.
 */

export type MuscleId =
  | 'chest'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'traps'
  | 'upperBack'
  | 'lats'
  | 'lowerBack'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves'
  | 'abductors'
  | 'adductors';

export const MUSCLE_IDS: readonly MuscleId[] = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'obliques',
  'traps', 'upperBack', 'lats', 'lowerBack', 'glutes', 'quads', 'hamstrings', 'calves',
  'abductors', 'adductors',
];

/**
 * The muscles Tyson has DRAWN as Krita masks per view — the ids only (the
 * asset requires live in ui/muscle-map/front-masks.ts, typed against this
 * list). Grows with the artwork, never ahead of it.
 */
export const FRONT_MASKED_IDS = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'traps', 'abs',
  'obliques', 'quads', 'abductors', 'adductors', 'calves',
] as const;
export type FrontMuscleId = (typeof FRONT_MASKED_IDS)[number];

export const BACK_MASKED_IDS = ['shoulders', 'triceps', 'traps'] as const;
export type BackMuscleId = (typeof BACK_MASKED_IDS)[number];

/** Bilateral muscles carry left+right; the midline ones a single path. */
export interface MusclePathSides {
  left?: string;
  right?: string;
  center?: string;
}

export type MusclePathTable = Partial<Record<MuscleId, MusclePathSides>>;

/** The SVG coordinate system == the base images' pixel grid. */
export const MAP_VIEW_W = 887;
export const MAP_VIEW_H = 1774;

export type MuscleView = 'front' | 'back';

/** Human labels for accessibility announcements. */
export const MUSCLE_LABEL: Readonly<Record<MuscleId, string>> = {
  chest: 'chest',
  shoulders: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  abs: 'abs',
  obliques: 'obliques',
  traps: 'traps',
  upperBack: 'upper back',
  lats: 'lats',
  lowerBack: 'lower back',
  glutes: 'glutes',
  quads: 'quadriceps',
  hamstrings: 'hamstrings',
  calves: 'calves',
  abductors: 'abductors',
  adductors: 'adductors',
};

/**
 * Label → MuscleId. The first block is the app's own 17-tag taxonomy
 * (exercise-taxonomy MUSCLE_GROUPS) — what the muscle ladder actually emits;
 * the rest are common gym/database synonyms.
 */
const TABLE: Readonly<Record<string, MuscleId>> = {
  // ---- the app's fine-grained tags (the muscle ladder's vocabulary) ----
  'chest': 'chest',
  'upper chest': 'chest',
  'back width': 'lats',
  'back thickness': 'upperBack',
  'traps': 'traps',
  'side delts': 'shoulders',
  'rear delts': 'shoulders',
  'front delts': 'shoulders',
  'biceps': 'biceps',
  'triceps': 'triceps',
  'forearms': 'forearms',
  'quads': 'quads',
  'hamstrings': 'hamstrings',
  'glutes': 'glutes',
  'calves': 'calves',
  // Real regions since Tyson drew their masks (2026-07-15) — adductors used
  // to borrow the quad mass.
  'adductors': 'adductors',
  'abductors': 'abductors',
  'abs': 'abs',

  // ---- common synonyms (imported datasets, AI labels, human typing) ----
  'pecs': 'chest',
  'pectorals': 'chest',
  'pectoralis major': 'chest',
  'delts': 'shoulders',
  'deltoids': 'shoulders',
  'shoulders': 'shoulders',
  'lats': 'lats',
  'lat': 'lats',
  'latissimus dorsi': 'lats',
  'trapezius': 'traps',
  'upper back': 'upperBack',
  'rhomboids': 'upperBack',
  'middle back': 'upperBack',
  'lower back': 'lowerBack',
  'lumbar': 'lowerBack',
  'erectors': 'lowerBack',
  'erector spinae': 'lowerBack',
  'abdominals': 'abs',
  'core': 'abs',
  'obliques': 'obliques',
  'quadriceps': 'quads',
  'hams': 'hamstrings',
  'gluteus': 'glutes',
  'gluteus maximus': 'glutes',
  'hip abductors': 'abductors',
  'abduction': 'abductors',
  'hip adductors': 'adductors',
  'adduction': 'adductors',
  'inner thigh': 'adductors',
  'outer thigh': 'abductors',
  'calf': 'calves',
  'bicep': 'biceps',
  'tricep': 'triceps',
  'forearm': 'forearms',
  'back': 'upperBack',
  'legs': 'quads',
};

export function normaliseMuscleGroup(label: string): MuscleId | null {
  return TABLE[label.trim().toLowerCase()] ?? null;
}

/** Which half of the body a muscle lives on — drives the map's zoom. */
export type MuscleZone = 'upper' | 'lower';
export type MapFocus = 'upper' | 'lower' | 'full';

export const MUSCLE_ZONE: Readonly<Record<MuscleId, MuscleZone>> = {
  chest: 'upper',
  shoulders: 'upper',
  biceps: 'upper',
  triceps: 'upper',
  forearms: 'upper',
  abs: 'upper',
  obliques: 'upper',
  traps: 'upper',
  upperBack: 'upper',
  lats: 'upper',
  lowerBack: 'upper',
  glutes: 'lower',
  quads: 'lower',
  hamstrings: 'lower',
  calves: 'lower',
  abductors: 'lower',
  adductors: 'lower',
};

/**
 * All-upper day → zoom the torso; all-lower → zoom the legs; a mixed (or
 * empty) day shows the whole figure. An empty day zooming anywhere would be
 * a close-up of nothing in particular.
 */
export function focusFor(muscles: readonly MuscleId[]): MapFocus {
  if (muscles.length === 0) return 'full';
  const zones = new Set(muscles.map((m) => MUSCLE_ZONE[m]));
  if (zones.size > 1) return 'full';
  return zones.has('lower') ? 'lower' : 'upper';
}

/** Many labels → the deduped MuscleId set, order of first appearance. */
export function muscleIdsFor(labels: readonly string[]): MuscleId[] {
  const out: MuscleId[] = [];
  for (const label of labels) {
    const id = normaliseMuscleGroup(label);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The hero card's chips, title-cased from the map's own vocabulary — a Push
 * day reads Chest · Shoulders · Triceps, never a vague "Arms".
 */
export function pillLabelsFor(muscles: readonly MuscleId[]): string[] {
  return muscles.map((m) =>
    MUSCLE_LABEL[m]
      .split(' ')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  );
}
