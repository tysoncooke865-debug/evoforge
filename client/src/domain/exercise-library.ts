/**
 * THE EXERCISE LIBRARY (Tyson, 2026-07-13): the big muscle-tagged list
 * behind the routine builder and exercise substitution. Names are chosen
 * so `inferMuscleGroup()` (the heat-map/coefficient cascade) agrees with
 * the explicit tag — logged rows keep feeding stats exactly as before.
 * UI groups collapse the fine-grained tags into gym-familiar sections.
 */

export interface LibraryExercise {
  name: string;
  muscle: string; // inferMuscleGroup-compatible tag
}

export const EXERCISE_LIBRARY: readonly LibraryExercise[] = [
  // ------------------------------------------------------------- chest
  { name: 'Barbell Bench Press', muscle: 'Chest' },
  { name: 'Paused Barbell Bench Press', muscle: 'Chest' },
  { name: 'Dumbbell Flat Bench Press', muscle: 'Chest' },
  { name: 'Machine Chest Press', muscle: 'Chest' },
  { name: 'Smith Machine Bench Press', muscle: 'Chest' },
  { name: 'Pec Deck Machine Fly', muscle: 'Chest' },
  { name: 'Cable Chest Fly', muscle: 'Chest' },
  { name: 'Dumbbell Chest Fly', muscle: 'Chest' },
  { name: 'Weighted Chest Dip', muscle: 'Chest' },
  { name: 'Decline Push-Up', muscle: 'Chest' },
  { name: 'Decline Barbell Bench Press', muscle: 'Chest' },
  // ------------------------------------------------------- upper chest
  { name: 'Incline Barbell Bench Press', muscle: 'Upper Chest' },
  { name: 'Incline Dumbbell Bench Press', muscle: 'Upper Chest' },
  { name: 'Incline Machine Chest Press', muscle: 'Upper Chest' },
  { name: 'Low-to-High Incline Cable Fly', muscle: 'Upper Chest' },
  { name: 'Incline Smith Machine Bench Press', muscle: 'Upper Chest' },
  // -------------------------------------------------------- back width
  { name: 'Lat Pulldown', muscle: 'Back Width' },
  { name: 'Close-Grip Lat Pulldown', muscle: 'Back Width' },
  { name: 'Weighted Pull-Up', muscle: 'Back Width' },
  { name: 'Assisted Pull-Up', muscle: 'Back Width' },
  { name: 'Cable Lat Pullover (Straight-Arm Pulldown)', muscle: 'Back Width' },
  { name: 'Machine Lat Pulldown', muscle: 'Back Width' },
  { name: 'Neutral-Grip Pulldown', muscle: 'Back Width' },
  // ---------------------------------------------------- back thickness
  { name: 'Chest-Supported Machine Row', muscle: 'Back Thickness' },
  { name: 'Chest-Supported Dumbbell Row', muscle: 'Back Thickness' },
  { name: 'Barbell Bent-Over Row', muscle: 'Back Thickness' },
  { name: 'T-Bar Row', muscle: 'Back Thickness' },
  { name: 'Seated Cable Row', muscle: 'Back Thickness' },
  { name: 'Single-Arm Dumbbell Row', muscle: 'Back Thickness' },
  { name: 'Machine High Row', muscle: 'Back Thickness' },
  { name: 'Pendlay Row', muscle: 'Back Thickness' },
  { name: 'Rack Pull', muscle: 'Back Thickness' },
  // -------------------------------------------------------- side delts
  { name: 'Cable Lateral Raise', muscle: 'Side Delts' },
  { name: 'Dumbbell Lateral Raise', muscle: 'Side Delts' },
  { name: 'Machine Lateral Raise', muscle: 'Side Delts' },
  { name: 'Seated Dumbbell Lateral Raise', muscle: 'Side Delts' },
  { name: 'Leaning Cable Lateral Raise', muscle: 'Side Delts' },
  // -------------------------------------------------------- rear delts
  { name: 'Reverse Pec Deck (Rear Delt Fly)', muscle: 'Rear Delts' },
  { name: 'Face Pull', muscle: 'Rear Delts' },
  { name: 'Bent-Over Rear Delt Fly', muscle: 'Rear Delts' },
  { name: 'Cable Rear Delt Fly', muscle: 'Rear Delts' },
  // ---------------------------------------------------- front delts / press
  { name: 'Overhead Barbell Press', muscle: 'Front Delts' },
  { name: 'Seated Dumbbell Shoulder Press', muscle: 'Front Delts' },
  { name: 'Machine Shoulder Press', muscle: 'Front Delts' },
  { name: 'Arnold Press', muscle: 'Front Delts' },
  { name: 'Smith Machine Shoulder Press', muscle: 'Front Delts' },
  // ------------------------------------------------------------ biceps
  { name: 'EZ-Bar Curl', muscle: 'Biceps' },
  { name: 'Dumbbell Biceps Curl', muscle: 'Biceps' },
  { name: 'Incline Dumbbell Curl', muscle: 'Biceps' },
  { name: 'Hammer Curl', muscle: 'Biceps' },
  { name: 'Preacher Curl', muscle: 'Biceps' },
  { name: 'Cable Biceps Curl', muscle: 'Biceps' },
  { name: 'Machine Biceps Curl', muscle: 'Biceps' },
  { name: 'Barbell Curl', muscle: 'Biceps' },
  { name: 'Spider Curl', muscle: 'Biceps' },
  // ----------------------------------------------------------- triceps
  { name: 'Cable Triceps Pushdown', muscle: 'Triceps' },
  { name: 'Rope Triceps Pushdown', muscle: 'Triceps' },
  { name: 'Overhead Cable Triceps Extension', muscle: 'Triceps' },
  { name: 'Skull Crusher (Lying Triceps Extension)', muscle: 'Triceps' },
  { name: 'Close-Grip Bench Press', muscle: 'Triceps' },
  { name: 'Weighted Triceps Dip', muscle: 'Triceps' },
  { name: 'Machine Triceps Extension', muscle: 'Triceps' },
  { name: 'Dumbbell Triceps Kickback', muscle: 'Triceps' },
  // ------------------------------------------------------------- quads
  { name: 'Barbell Back Squat', muscle: 'Quads' },
  { name: 'Front Squat', muscle: 'Quads' },
  { name: 'Hack Squat Machine', muscle: 'Quads' },
  { name: 'Leg Press', muscle: 'Quads' },
  { name: 'Bulgarian Split Squat', muscle: 'Quads' },
  { name: 'Leg Extension', muscle: 'Quads' },
  { name: 'Smith Machine Squat', muscle: 'Quads' },
  { name: 'Walking Lunge', muscle: 'Quads' },
  { name: 'Goblet Squat', muscle: 'Quads' },
  { name: 'Pendulum Squat', muscle: 'Quads' },
  // -------------------------------------------------------- hamstrings
  { name: 'Romanian Deadlift', muscle: 'Hamstrings' },
  { name: 'Barbell Deadlift', muscle: 'Hamstrings' },
  { name: 'Seated/Lying Leg Curl', muscle: 'Hamstrings' },
  { name: 'Seated Leg Curl', muscle: 'Hamstrings' },
  { name: 'Lying Leg Curl', muscle: 'Hamstrings' },
  { name: 'Stiff-Leg Deadlift', muscle: 'Hamstrings' },
  { name: 'Nordic Ham Curl', muscle: 'Hamstrings' },
  { name: 'Good Morning', muscle: 'Hamstrings' },
  // ------------------------------------------------------------ glutes
  { name: 'Barbell Hip Thrust', muscle: 'Glutes' },
  { name: 'Machine Hip Thrust', muscle: 'Glutes' },
  { name: 'Cable Glute Kickback', muscle: 'Glutes' },
  { name: 'Glute Bridge', muscle: 'Glutes' },
  { name: 'Machine Glute Kickback', muscle: 'Glutes' },
  // ------------------------------------------------------------ calves
  { name: 'Seated Calf Raise', muscle: 'Calves' },
  { name: 'Standing Calf Raise', muscle: 'Calves' },
  { name: 'Leg Press Calf Raise', muscle: 'Calves' },
  { name: 'Smith Machine Calf Raise', muscle: 'Calves' },
  // --------------------------------------------------------- adductors
  { name: 'Hip Adduction Machine', muscle: 'Adductors' },
  { name: 'Hip Abduction Machine', muscle: 'Adductors' },
  // -------------------------------------------------------------- abs
  { name: 'Machine Ab Crunch', muscle: 'Abs' },
  { name: 'Cable Crunch', muscle: 'Abs' },
  { name: 'Lying Leg Raise', muscle: 'Abs' },
  { name: 'Hanging Leg Raise', muscle: 'Abs' },
  { name: 'Weighted Sit-Up', muscle: 'Abs' },
  { name: 'Ab Wheel Rollout', muscle: 'Abs' },
  { name: 'Weighted Plank', muscle: 'Abs' },
  { name: 'Decline Sit-Up', muscle: 'Abs' },
  // ---------------------------------------------------------- forearms
  { name: 'Barbell Wrist Curl', muscle: 'Forearms' },
  { name: 'Reverse Barbell Wrist Curl', muscle: 'Forearms' },
  { name: 'Farmer Carry', muscle: 'Forearms' },
  { name: 'Reverse Curl', muscle: 'Forearms' },
  // -------------------------------------------------------------- traps
  { name: 'Barbell Shrug', muscle: 'Traps' },
  { name: 'Dumbbell Shrug', muscle: 'Traps' },
  { name: 'Cable Shrug', muscle: 'Traps' },
];

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

/** The routine-builder split presets. Day names become the plan's day
 *  chips on Train (custom plans drive their own day list). */
export const SPLITS: readonly { key: string; name: string; days: readonly string[] }[] = [
  { key: 'ppl6', name: 'Push / Pull / Legs · 6 days', days: ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'] },
  { key: 'ppl3', name: 'Push / Pull / Legs · 3 days', days: ['Push', 'Pull', 'Legs'] },
  { key: 'ul4', name: 'Upper / Lower · 4 days', days: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] },
  { key: 'fb3', name: 'Full Body · 3 days', days: ['Full Body 1', 'Full Body 2', 'Full Body 3'] },
  { key: 'bro5', name: 'Bro Split · 5 days', days: ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs'] },
];

export const REP_SCHEMES = ['5-8', '8-12', '12-20', 'AMRAP'] as const;
