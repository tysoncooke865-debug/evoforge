/**
 * THE EXERCISE LIBRARY (Tyson, 2026-07-13): the big muscle-tagged list
 * behind the routine builder and exercise substitution. UI groups collapse
 * the fine-grained tags into gym-familiar sections.
 *
 * TWO TIERS (2026-07-14):
 *  - CORE_EXERCISES below: hand-curated, and the ONLY names DAY_PRESETS
 *    seeds. Their wording was chosen so `inferMuscleGroup()` agrees with the
 *    explicit tag.
 *  - IMPORTED_EXERCISES: 848 more from the public-domain dataset, generated
 *    (exercise-library-imported.ts), exact-duplicate-free.
 *
 * THE LIBRARY'S TAG IS AUTHORITATIVE FOR A LOGGED SET (`libraryMuscleFor`,
 * threaded through useSaveSet): inferMuscleGroup is a heuristic over names it
 * was tuned for, and it has never seen most of the imported ones. Where the
 * library knows, it says; only an unknown name falls back to inference.
 * inferMuscleGroup itself is parity-pinned and does not move.
 */

import { IMPORTED_EXERCISES } from './exercise-library-imported';
import type { LibraryExercise } from './exercise-taxonomy';

export type { LibraryExercise } from './exercise-taxonomy';

const CORE_EXERCISES: readonly LibraryExercise[] = [
  // ------------------------------------------------------------- chest
  { name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Paused Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Flat Bench Press', muscle: 'Chest', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Chest Press', muscle: 'Chest', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Smith Machine Bench Press', muscle: 'Chest', equipment: 'Smith Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Pec Deck Machine Fly', muscle: 'Chest', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Chest Fly', muscle: 'Chest', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Chest Fly', muscle: 'Chest', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Weighted Chest Dip', muscle: 'Chest', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Decline Push-Up', muscle: 'Chest', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Decline Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // ------------------------------------------------------- upper chest
  { name: 'Incline Barbell Bench Press', muscle: 'Upper Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Incline Dumbbell Bench Press', muscle: 'Upper Chest', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Incline Machine Chest Press', muscle: 'Upper Chest', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Low-to-High Incline Cable Fly', muscle: 'Upper Chest', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Incline Smith Machine Bench Press', muscle: 'Upper Chest', equipment: 'Smith Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------- back width
  { name: 'Lat Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Close-Grip Lat Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Weighted Pull-Up', muscle: 'Back Width', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Assisted Pull-Up', muscle: 'Back Width', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Lat Pullover (Straight-Arm Pulldown)', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Lat Pulldown', muscle: 'Back Width', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Neutral-Grip Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // ---------------------------------------------------- back thickness
  { name: 'Chest-Supported Machine Row', muscle: 'Back Thickness', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Chest-Supported Dumbbell Row', muscle: 'Back Thickness', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Barbell Bent-Over Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'T-Bar Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated Cable Row', muscle: 'Back Thickness', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Single-Arm Dumbbell Row', muscle: 'Back Thickness', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine High Row', muscle: 'Back Thickness', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Pendlay Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Rack Pull', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------- side delts
  { name: 'Cable Lateral Raise', muscle: 'Side Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Lateral Raise', muscle: 'Side Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Lateral Raise', muscle: 'Side Delts', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated Dumbbell Lateral Raise', muscle: 'Side Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Leaning Cable Lateral Raise', muscle: 'Side Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------- rear delts
  { name: 'Reverse Pec Deck (Rear Delt Fly)', muscle: 'Rear Delts', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Face Pull', muscle: 'Rear Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Bent-Over Rear Delt Fly', muscle: 'Rear Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Rear Delt Fly', muscle: 'Rear Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // ---------------------------------------------------- front delts / press
  { name: 'Overhead Barbell Press', muscle: 'Front Delts', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated Dumbbell Shoulder Press', muscle: 'Front Delts', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Shoulder Press', muscle: 'Front Delts', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Arnold Press', muscle: 'Front Delts', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Smith Machine Shoulder Press', muscle: 'Front Delts', equipment: 'Smith Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // ------------------------------------------------------------ biceps
  { name: 'EZ-Bar Curl', muscle: 'Biceps', equipment: 'EZ Bar', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Biceps Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Incline Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Hammer Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Preacher Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Biceps Curl', muscle: 'Biceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Biceps Curl', muscle: 'Biceps', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Barbell Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Spider Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // ----------------------------------------------------------- triceps
  { name: 'Cable Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Rope Triceps Pushdown', muscle: 'Triceps', equipment: 'Other', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Overhead Cable Triceps Extension', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Skull Crusher (Lying Triceps Extension)', muscle: 'Triceps', equipment: 'Other', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Close-Grip Bench Press', muscle: 'Triceps', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Weighted Triceps Dip', muscle: 'Triceps', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Triceps Extension', muscle: 'Triceps', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Triceps Kickback', muscle: 'Triceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // ------------------------------------------------------------- quads
  { name: 'Barbell Back Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Front Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Hack Squat Machine', muscle: 'Quads', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Leg Press', muscle: 'Quads', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Bulgarian Split Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Leg Extension', muscle: 'Quads', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Smith Machine Squat', muscle: 'Quads', equipment: 'Smith Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Walking Lunge', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Goblet Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Pendulum Squat', muscle: 'Quads', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------- hamstrings
  { name: 'Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Barbell Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated/Lying Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Lying Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Stiff-Leg Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Nordic Ham Curl', muscle: 'Hamstrings', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Good Morning', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  // ------------------------------------------------------------ glutes
  { name: 'Barbell Hip Thrust', muscle: 'Glutes', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Hip Thrust', muscle: 'Glutes', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Glute Kickback', muscle: 'Glutes', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Glute Bridge', muscle: 'Glutes', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Machine Glute Kickback', muscle: 'Glutes', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // ------------------------------------------------------------ calves
  { name: 'Seated Calf Raise', muscle: 'Calves', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Standing Calf Raise', muscle: 'Calves', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Leg Press Calf Raise', muscle: 'Calves', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Smith Machine Calf Raise', muscle: 'Calves', equipment: 'Smith Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // --------------------------------------------------------- adductors
  { name: 'Hip Adduction Machine', muscle: 'Adductors', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Hip Abduction Machine', muscle: 'Adductors', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------------- abs
  { name: 'Machine Ab Crunch', muscle: 'Abs', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Crunch', muscle: 'Abs', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Lying Leg Raise', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Hanging Leg Raise', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Weighted Sit-Up', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Ab Wheel Rollout', muscle: 'Abs', equipment: 'Other', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Weighted Plank', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Decline Sit-Up', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // ---------------------------------------------------------- forearms
  { name: 'Barbell Wrist Curl', muscle: 'Forearms', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Reverse Barbell Wrist Curl', muscle: 'Forearms', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Farmer Carry', muscle: 'Forearms', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Reverse Curl', muscle: 'Forearms', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  // -------------------------------------------------------------- traps
  { name: 'Barbell Shrug', muscle: 'Traps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Dumbbell Shrug', muscle: 'Traps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Cable Shrug', muscle: 'Traps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
];

/** The whole library: the curated core FIRST (so search and substitution keep
 *  offering the staples before the long tail), then the imported set. */
export const EXERCISE_LIBRARY: readonly LibraryExercise[] = [
  ...CORE_EXERCISES,
  ...IMPORTED_EXERCISES,
];

/** Case-insensitive name → tag. Built once; the library is ~960 entries and
 *  this is read on every set save. */
const BY_NAME: ReadonlyMap<string, string> = new Map(
  EXERCISE_LIBRARY.map((e) => [e.name.trim().toLowerCase(), e.muscle])
);

/**
 * The muscle THE LIBRARY says this exercise trains, or null if it has never
 * heard of it. Callers fall back to inferMuscleGroup (pinned) — see
 * useSaveSet. This exists because inferMuscleGroup is a name heuristic, and
 * the 848 imported names are not names it was tuned for: without this, a
 * logged "Landmine Twist" would land in the fallback bucket instead of Abs.
 */
export function libraryMuscleFor(exercise: string): string | null {
  return BY_NAME.get(exercise.trim().toLowerCase()) ?? null;
}

/** Gym-familiar UI sections → the fine-grained tags they collapse. */
export const LIBRARY_SECTIONS: readonly { label: string; muscles: readonly string[] }[] = [
  { label: 'Chest', muscles: ['Chest', 'Upper Chest'] },
  { label: 'Back', muscles: ['Back Width', 'Back Thickness', 'Traps'] },
  { label: 'Shoulders', muscles: ['Side Delts', 'Rear Delts', 'Front Delts'] },
  { label: 'Arms', muscles: ['Biceps', 'Triceps', 'Forearms'] },
  { label: 'Legs', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors'] },
  { label: 'Abs', muscles: ['Abs'] },
];

export function exercisesFor(section: { muscles: readonly string[] }): LibraryExercise[] {
  return EXERCISE_LIBRARY.filter((e) => section.muscles.includes(e.muscle));
}

/** Same-muscle substitutes for an exercise (excludes itself). Falls back
 *  to the whole UI section so nothing ever offers zero alternatives. */
export function substitutesFor(exercise: string): LibraryExercise[] {
  const hit = EXERCISE_LIBRARY.find((e) => e.name === exercise || exercise.startsWith(e.name));
  if (!hit) {
    // Unknown name (e.g. "(Strength)" variants): infer by section scan.
    const section = LIBRARY_SECTIONS.find((s) =>
      exercisesFor(s).some((e) => exercise.toLowerCase().includes(e.name.toLowerCase().split(' ')[1] ?? '###'))
    );
    return section ? exercisesFor(section) : [...EXERCISE_LIBRARY];
  }
  const same = EXERCISE_LIBRARY.filter((e) => e.muscle === hit.muscle && e.name !== hit.name);
  if (same.length >= 3) return same;
  const section = LIBRARY_SECTIONS.find((s) => s.muscles.includes(hit.muscle));
  return section ? exercisesFor(section).filter((e) => e.name !== hit.name) : same;
}

/**
 * STAGE 1 — the staples behind each kind of training day. Every name here is
 * copied VERBATIM from EXERCISE_LIBRARY above, and a test pins that: a typo
 * would seed a routine with an exercise that has no muscle tag, and it would
 * quietly grade against nothing.
 */
export const DAY_PRESETS: Readonly<Record<string, readonly (readonly [string, number, string])[]>> = {
  'Chest & Back': [
    ['Barbell Bench Press', 4, '5-8'],
    ['Incline Dumbbell Bench Press', 3, '8-12'],
    ['Lat Pulldown', 4, '8-12'],
    ['Chest-Supported Machine Row', 3, '8-12'],
    ['Cable Chest Fly', 3, '12-20'],
  ],
  Arms: [
    ['EZ-Bar Curl', 3, '8-12'],
    ['Cable Triceps Pushdown', 3, '8-12'],
    ['Hammer Curl', 3, '12-20'],
    ['Overhead Cable Triceps Extension', 3, '12-20'],
    ['Cable Lateral Raise', 3, '12-20'],
  ],
  'Legs & Core': [
    ['Barbell Back Squat', 4, '5-8'],
    ['Romanian Deadlift', 3, '8-12'],
    ['Leg Press', 3, '8-12'],
    ['Seated Leg Curl', 3, '12-20'],
    ['Hanging Leg Raise', 3, '12-20'],
  ],
  Upper: [
    ['Barbell Bench Press', 4, '5-8'],
    ['Lat Pulldown', 4, '8-12'],
    ['Overhead Barbell Press', 3, '8-12'],
    ['Seated Cable Row', 3, '8-12'],
    ['Dumbbell Lateral Raise', 3, '12-20'],
    ['EZ-Bar Curl', 3, '12-20'],
  ],
  Lower: [
    ['Barbell Back Squat', 4, '5-8'],
    ['Romanian Deadlift', 3, '8-12'],
    ['Leg Press', 3, '8-12'],
    ['Lying Leg Curl', 3, '12-20'],
    ['Standing Calf Raise', 4, '12-20'],
  ],
  Push: [
    ['Barbell Bench Press', 4, '5-8'],
    ['Overhead Barbell Press', 3, '8-12'],
    ['Incline Dumbbell Bench Press', 3, '8-12'],
    ['Cable Lateral Raise', 3, '12-20'],
    ['Cable Triceps Pushdown', 3, '12-20'],
  ],
  Pull: [
    ['Weighted Pull-Up', 4, '5-8'],
    ['Barbell Bent-Over Row', 3, '8-12'],
    ['Seated Cable Row', 3, '8-12'],
    ['Face Pull', 3, '12-20'],
    ['EZ-Bar Curl', 3, '12-20'],
  ],
  Legs: [
    ['Barbell Back Squat', 4, '5-8'],
    ['Romanian Deadlift', 3, '8-12'],
    ['Leg Extension', 3, '12-20'],
    ['Seated Leg Curl', 3, '12-20'],
    ['Seated Calf Raise', 4, '12-20'],
  ],
  'Full Body': [
    ['Barbell Back Squat', 3, '5-8'],
    ['Barbell Bench Press', 3, '5-8'],
    ['Lat Pulldown', 3, '8-12'],
    ['Romanian Deadlift', 3, '8-12'],
    ['Dumbbell Lateral Raise', 3, '12-20'],
  ],
};

/** The routine-builder split presets. Day names become the plan's day
 *  chips on Train (custom plans drive their own day list).
 *  `preset` names the DAY_PRESETS entry each day seeds from — a day with no
 *  preset seeds empty, which is what `custom` wants. */
export interface Split {
  key: string;
  name: string;
  days: readonly string[];
  /** day name -> DAY_PRESETS key. */
  presets?: Readonly<Record<string, string>>;
  /** Weekdays to train, as JS getUTCDay() numbers. */
  weekdays?: readonly number[];
}

export const SPLITS: readonly Split[] = [
  {
    key: 'ppl6',
    name: 'Push / Pull / Legs · 6 days',
    days: ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'],
    presets: { 'Push A': 'Push', 'Pull A': 'Pull', 'Legs A': 'Legs', 'Push B': 'Push', 'Pull B': 'Pull', 'Legs B': 'Legs' },
    weekdays: [1, 2, 3, 4, 5, 6],
  },
  {
    key: 'ppl3',
    name: 'Push / Pull / Legs · 3 days',
    days: ['Push', 'Pull', 'Legs'],
    presets: { Push: 'Push', Pull: 'Pull', Legs: 'Legs' },
    weekdays: [1, 3, 5],
  },
  {
    key: 'ul4',
    name: 'Upper / Lower · 4 days',
    days: ['Upper A', 'Lower A', 'Upper B', 'Lower B'],
    presets: { 'Upper A': 'Upper', 'Lower A': 'Lower', 'Upper B': 'Upper', 'Lower B': 'Lower' },
    weekdays: [1, 2, 4, 5],
  },
  {
    key: 'cbal3',
    name: 'Chest&Back / Arms / Legs&Core · 3 days',
    days: ['Chest & Back', 'Arms', 'Legs & Core'],
    presets: { 'Chest & Back': 'Chest & Back', Arms: 'Arms', 'Legs & Core': 'Legs & Core' },
    weekdays: [1, 3, 5],
  },
  {
    key: 'fb3',
    name: 'Full Body · 3 days',
    days: ['Full Body 1', 'Full Body 2', 'Full Body 3'],
    presets: { 'Full Body 1': 'Full Body', 'Full Body 2': 'Full Body', 'Full Body 3': 'Full Body' },
    weekdays: [1, 3, 5],
  },
  {
    key: 'bro5',
    name: 'Bro Split · 5 days',
    days: ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs'],
    presets: { Arms: 'Arms', Legs: 'Legs' },
    weekdays: [1, 2, 3, 4, 5],
  },
  { key: 'custom', name: 'Custom · name your own days', days: [] },
];

export const REP_SCHEMES = ['5-8', '8-12', '12-20', 'AMRAP'] as const;

/** The staples for a day, or [] when that day has no preset (custom days). */
export function presetFor(split: Split, day: string): readonly (readonly [string, number, string])[] {
  const key = split.presets?.[day];
  return key ? (DAY_PRESETS[key] ?? []) : [];
}

export interface SeedExercise {
  exercise: string;
  sets: number;
  reps: string;
  reason: string;
}

/**
 * A ready-to-save plan for a split — onboarding's one-tap path. Null for
 * `custom` (there is nothing to seed) and for any split without presets.
 */
export function seedPlanForSplit(
  splitKey: string
): { plan_name: string; days: { day: string; goal: string; exercises: SeedExercise[] }[] } | null {
  const split = SPLITS.find((s) => s.key === splitKey);
  if (!split || split.days.length === 0 || !split.presets) return null;
  const days = split.days.map((day) => ({
    day,
    goal: '',
    exercises: presetFor(split, day).map(([exercise, sets, reps]) => ({
      exercise,
      sets,
      reps,
      reason: '',
    })),
  }));
  // A split whose days seed nothing is not a seedable split.
  if (days.every((d) => d.exercises.length === 0)) return null;
  return { plan_name: split.name, days };
}

/** Gym-sensible weekday spreads for N training days (getUTCDay indices):
 *  rest days sit BETWEEN sessions, not stacked at the weekend. */
const DAY_SPREAD: Readonly<Record<number, readonly number[]>> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * The weekly schedule ANY day list implies (PLAN SCAN fix, 2026-07-15) —
 * imported and hand-built plans map onto the week like preset splits do, so
 * the week bars, MISSED states and the scheduled streak know the program
 * exists. Same jsonb shape as defaultScheduleFor: keys '0'..'6' = getUTCDay,
 * values a day name or 'Rest'.
 */
export function scheduleForDays(days: readonly string[]): Record<string, string> | null {
  const list = days.filter((d) => d.trim() !== '').slice(0, 7);
  if (list.length === 0) return null;
  const spread = DAY_SPREAD[list.length];
  const plan: Record<string, string> = { '0': 'Rest', '1': 'Rest', '2': 'Rest', '3': 'Rest', '4': 'Rest', '5': 'Rest', '6': 'Rest' };
  spread.forEach((dow, i) => {
    plan[String(dow)] = list[i];
  });
  return plan;
}

/**
 * The weekly schedule a split implies: workout_schedule's jsonb shape
 * (keys '0'..'6' = getUTCDay, values a day name or 'Rest'). Days beyond the
 * split's weekday count are Rest — a 3-day split must not silently claim six.
 */
export function defaultScheduleFor(splitKey: string): Record<string, string> | null {
  const split = SPLITS.find((s) => s.key === splitKey);
  if (!split || split.days.length === 0 || !split.weekdays) return null;
  const plan: Record<string, string> = { '0': 'Rest', '1': 'Rest', '2': 'Rest', '3': 'Rest', '4': 'Rest', '5': 'Rest', '6': 'Rest' };
  split.weekdays.forEach((dow, i) => {
    const day = split.days[i];
    if (day) plan[String(dow)] = day;
  });
  return plan;
}
