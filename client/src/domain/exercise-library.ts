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
  { name: 'Rack Pull', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', secondary: ['Erectors', 'Traps', 'Forearms'], popularity: 100 },
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
  { name: 'Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Glutes', 'Erectors'], popularity: 100 },
  // Erectors joined the taxonomy 2026-07-15: a conventional deadlift is
  // erector-primary (avatar strength scoring reads this row by NAME, so the
  // tag change cannot touch it).
  { name: 'Barbell Deadlift', muscle: 'Erectors', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Hamstrings', 'Glutes', 'Traps', 'Forearms'], popularity: 100 },
  { name: 'Seated/Lying Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Seated Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Lying Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Stiff-Leg Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Glutes', 'Erectors'], popularity: 100 },
  { name: 'Nordic Ham Curl', muscle: 'Hamstrings', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
  { name: 'Good Morning', muscle: 'Hamstrings', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Erectors', 'Glutes'], popularity: 100 },
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
  // Retagged 2026-07-15 (Erectors/Abductors joined the taxonomy): an
  // abduction machine trains abductors, not adductors.
  { name: 'Hip Abduction Machine', muscle: 'Abductors', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 100 },
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

  // ===================================================================
  // EXPANDED VARIANTS (Tyson, 2026-07-23): fuller per-equipment / per-grip
  // coverage so substitution always offers the exact machine an athlete has.
  // popularity 90 keeps the top staples above (100) surfacing first. Every
  // name here was collision-checked against the whole library (core +
  // imported) — no case-insensitive duplicate.
  // ----------------------------------------------------------- triceps
  { name: 'Single-Arm Cable Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'V-Bar Cable Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Straight-Bar Cable Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Reverse-Grip Cable Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Rope Overhead Cable Triceps Extension', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'EZ-Bar Overhead Triceps Extension', muscle: 'Triceps', equipment: 'EZ Bar', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Dumbbell Overhead Triceps Extension', muscle: 'Triceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Dumbbell Overhead Triceps Extension', muscle: 'Triceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Cable Triceps Kickback', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Dumbbell Skull Crusher', muscle: 'Triceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Bench Dip', muscle: 'Triceps', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Beginner', popularity: 90 },
  { name: 'Cross-Body Cable Triceps Extension', muscle: 'Triceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  // ------------------------------------------------------------ biceps
  { name: 'Seated Dumbbell Concentration Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Cable Rope Hammer Curl', muscle: 'Biceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Cable Biceps Curl', muscle: 'Biceps', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Wide-Grip Barbell Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Close-Grip Barbell Curl', muscle: 'Biceps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Machine Preacher Curl', muscle: 'Biceps', equipment: 'Machine', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Dumbbell Preacher Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Seated Dumbbell Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Cross-Body Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  // -------------------------------------------------------- side delts
  { name: 'Behind-the-Back Cable Lateral Raise', muscle: 'Side Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Dumbbell Lateral Raise', muscle: 'Side Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Lying Dumbbell Lateral Raise', muscle: 'Side Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Cable Upright Row', muscle: 'Side Delts', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', secondary: ['Traps'], popularity: 90 },
  { name: 'Barbell Upright Row', muscle: 'Side Delts', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Traps'], popularity: 90 },
  { name: 'Dumbbell Upright Row', muscle: 'Side Delts', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Traps'], popularity: 90 },
  // -------------------------------------------------------- rear delts
  { name: 'Single-Arm Cable Rear Delt Fly', muscle: 'Rear Delts', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Seated Bent-Over Dumbbell Rear Delt Fly', muscle: 'Rear Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Prone Incline Dumbbell Rear Delt Raise', muscle: 'Rear Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  // ------------------------------------------------------- front delts
  { name: 'Dumbbell Front Raise', muscle: 'Front Delts', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Barbell Front Raise', muscle: 'Front Delts', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Plate Front Raise', muscle: 'Front Delts', equipment: 'Other', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Seated Barbell Overhead Press', muscle: 'Front Delts', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Standing Dumbbell Shoulder Press', muscle: 'Front Delts', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Landmine Press', muscle: 'Front Delts', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Dumbbell Shoulder Press', muscle: 'Front Delts', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  // ------------------------------------------------------------- chest
  { name: 'High-to-Low Cable Chest Fly', muscle: 'Chest', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Arm Cable Chest Fly', muscle: 'Chest', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Standing Low-to-High Cable Chest Fly', muscle: 'Chest', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Barbell Floor Press', muscle: 'Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Deficit Push-Up', muscle: 'Chest', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Close-Grip Dumbbell Bench Press', muscle: 'Chest', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Neutral-Grip Dumbbell Bench Press', muscle: 'Chest', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  // ------------------------------------------------------- upper chest
  { name: 'Incline Cable Press', muscle: 'Upper Chest', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Reverse-Grip Barbell Bench Press', muscle: 'Upper Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Low-Incline Dumbbell Bench Press', muscle: 'Upper Chest', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  // -------------------------------------------------------- back width
  { name: 'Single-Arm Lat Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps'], popularity: 90 },
  { name: 'Behind-the-Neck Lat Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Advanced', secondary: ['Biceps'], popularity: 90 },
  { name: 'Reverse-Grip Lat Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps'], popularity: 90 },
  { name: 'Kneeling Cable Pulldown', muscle: 'Back Width', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps'], popularity: 90 },
  { name: 'Machine-Assisted Chin-Up', muscle: 'Back Width', equipment: 'Machine', category: 'Compound', difficulty: 'Beginner', secondary: ['Biceps'], popularity: 90 },
  // ---------------------------------------------------- back thickness
  { name: 'Meadows-Style Landmine Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps', 'Rear Delts'], popularity: 90 },
  { name: 'Seal Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps', 'Rear Delts'], popularity: 90 },
  { name: 'Chest-Supported T-Bar Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps', 'Rear Delts'], popularity: 90 },
  { name: 'Single-Arm Cable Row', muscle: 'Back Thickness', equipment: 'Cable', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps'], popularity: 90 },
  { name: 'Barbell Landmine Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Biceps', 'Rear Delts'], popularity: 90 },
  { name: 'Yates Row', muscle: 'Back Thickness', equipment: 'Barbell', category: 'Compound', difficulty: 'Advanced', secondary: ['Biceps', 'Traps'], popularity: 90 },
  // ------------------------------------------------------------- quads
  { name: 'Sissy Squat', muscle: 'Quads', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Advanced', popularity: 90 },
  { name: 'Single-Leg Leg Press', muscle: 'Quads', equipment: 'Machine', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Reverse Lunge', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Glutes', 'Hamstrings'], popularity: 90 },
  { name: 'Dumbbell Step-Up', muscle: 'Quads', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Glutes'], popularity: 90 },
  { name: 'Pause Back Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Advanced', secondary: ['Glutes'], popularity: 90 },
  { name: 'Zercher Squat', muscle: 'Quads', equipment: 'Barbell', category: 'Compound', difficulty: 'Advanced', secondary: ['Glutes', 'Erectors'], popularity: 90 },
  // -------------------------------------------------------- hamstrings
  { name: 'Single-Leg Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Advanced', secondary: ['Glutes', 'Erectors'], popularity: 90 },
  { name: 'Dumbbell Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Glutes', 'Erectors'], popularity: 90 },
  { name: 'Glute-Ham Raise', muscle: 'Hamstrings', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Advanced', secondary: ['Glutes'], popularity: 90 },
  { name: 'Single-Leg Lying Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  // ------------------------------------------------------------ glutes
  { name: 'Single-Leg Hip Thrust', muscle: 'Glutes', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Intermediate', secondary: ['Hamstrings'], popularity: 90 },
  { name: 'Dumbbell Hip Thrust', muscle: 'Glutes', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Beginner', secondary: ['Hamstrings'], popularity: 90 },
  { name: 'B-Stance Hip Thrust', muscle: 'Glutes', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Hamstrings'], popularity: 90 },
  { name: 'Curtsy Lunge', muscle: 'Glutes', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', secondary: ['Quads'], popularity: 90 },
  { name: 'Banded Glute Kickback', muscle: 'Glutes', equipment: 'Band', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  // ------------------------------------------------------------ calves
  { name: 'Donkey Calf Raise', muscle: 'Calves', equipment: 'Machine', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Single-Leg Standing Calf Raise', muscle: 'Calves', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Dumbbell Standing Calf Raise', muscle: 'Calves', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  // --------------------------------------------------------------- abs
  { name: 'Hanging Knee Raise', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Captain\'s Chair Leg Raise', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Weighted Bicycle Crunch', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Toes-to-Bar', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Advanced', popularity: 90 },
  { name: 'Cable Pallof Press', muscle: 'Abs', equipment: 'Cable', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Weighted Decline Crunch', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  // ---------------------------------------------------------- forearms
  { name: 'Behind-the-Back Barbell Wrist Curl', muscle: 'Forearms', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Dumbbell Wrist Curl', muscle: 'Forearms', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Reverse EZ-Bar Curl', muscle: 'Forearms', equipment: 'EZ Bar', category: 'Isolation', difficulty: 'Intermediate', secondary: ['Biceps'], popularity: 90 },
  // -------------------------------------------------------------- traps
  { name: 'Smith Machine Shrug', muscle: 'Traps', equipment: 'Smith Machine', category: 'Isolation', difficulty: 'Beginner', popularity: 90 },
  { name: 'Trap Bar Shrug', muscle: 'Traps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Snatch-Grip Barbell Shrug', muscle: 'Traps', equipment: 'Barbell', category: 'Isolation', difficulty: 'Intermediate', secondary: ['Rear Delts'], popularity: 90 },
];

/** The whole library: the curated core FIRST (so search and substitution keep
 *  offering the staples before the long tail), then the imported set. */
export const EXERCISE_LIBRARY: readonly LibraryExercise[] = [
  ...CORE_EXERCISES,
  ...IMPORTED_EXERCISES,
];

/** Name → muscle moved to muscle-lookup.ts (perf, 2026-07-23): set save and
 *  the Home/Train cards need ONLY that projection, and importing it from here
 *  dragged the whole library into the shared boot chunk. The data rides
 *  muscle-by-name.generated.ts, pinned to THIS array by
 *  __tests__/muscle-by-name.test.ts — regenerate with
 *  `node scripts/gen-muscle-by-name.mjs` whenever entries change.
 *  Re-exported here so picker/builder-side callers keep one import. */
export { libraryMuscleFor } from './muscle-lookup';

/** Gym-familiar UI sections → the fine-grained tags they collapse. */
export const LIBRARY_SECTIONS: readonly { label: string; muscles: readonly string[] }[] = [
  { label: 'Chest', muscles: ['Chest', 'Upper Chest'] },
  { label: 'Back', muscles: ['Back Width', 'Back Thickness', 'Traps', 'Erectors'] },
  { label: 'Shoulders', muscles: ['Side Delts', 'Rear Delts', 'Front Delts'] },
  { label: 'Arms', muscles: ['Biceps', 'Triceps', 'Forearms'] },
  { label: 'Legs', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abductors'] },
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
  // ---- EXPANDED DAY TEMPLATES (2026-07-23), seeding the new splits below.
  // Every name is copied VERBATIM from EXERCISE_LIBRARY (the test pins this).
  'Chest & Triceps': [
    ['Barbell Bench Press', 4, '5-8'],
    ['Incline Dumbbell Bench Press', 3, '8-12'],
    ['Machine Chest Press', 3, '8-12'],
    ['Cable Triceps Pushdown', 3, '12-20'],
    ['Overhead Cable Triceps Extension', 3, '12-20'],
  ],
  'Back & Biceps': [
    ['Weighted Pull-Up', 4, '5-8'],
    ['Barbell Bent-Over Row', 3, '8-12'],
    ['Seated Cable Row', 3, '8-12'],
    ['EZ-Bar Curl', 3, '12-20'],
    ['Hammer Curl', 3, '12-20'],
  ],
  'Shoulders & Arms': [
    ['Overhead Barbell Press', 4, '5-8'],
    ['Dumbbell Lateral Raise', 3, '12-20'],
    ['Face Pull', 3, '12-20'],
    ['EZ-Bar Curl', 3, '8-12'],
    ['Cable Triceps Pushdown', 3, '8-12'],
  ],
  Chest: [
    ['Barbell Bench Press', 4, '5-8'],
    ['Incline Barbell Bench Press', 3, '8-12'],
    ['Machine Chest Press', 3, '8-12'],
    ['Cable Chest Fly', 3, '12-20'],
    ['Weighted Chest Dip', 3, '8-12'],
  ],
  Back: [
    ['Weighted Pull-Up', 4, '5-8'],
    ['Barbell Bent-Over Row', 4, '8-12'],
    ['Lat Pulldown', 3, '8-12'],
    ['Seated Cable Row', 3, '12-20'],
    ['Face Pull', 3, '12-20'],
  ],
  Shoulders: [
    ['Overhead Barbell Press', 4, '5-8'],
    ['Dumbbell Lateral Raise', 4, '12-20'],
    ['Reverse Pec Deck (Rear Delt Fly)', 3, '12-20'],
    ['Cable Lateral Raise', 3, '12-20'],
    ['Barbell Shrug', 3, '8-12'],
  ],
  'Upper Power': [
    ['Barbell Bench Press', 4, '5-8'],
    ['Barbell Bent-Over Row', 4, '5-8'],
    ['Overhead Barbell Press', 3, '5-8'],
    ['Weighted Pull-Up', 3, '5-8'],
    ['Close-Grip Bench Press', 3, '8-12'],
  ],
  'Lower Power': [
    ['Barbell Back Squat', 4, '5-8'],
    ['Barbell Deadlift', 3, '5-8'],
    ['Leg Press', 3, '8-12'],
    ['Seated Leg Curl', 3, '8-12'],
    ['Standing Calf Raise', 4, '8-12'],
  ],
  'Upper Hypertrophy': [
    ['Incline Dumbbell Bench Press', 4, '8-12'],
    ['Seated Cable Row', 4, '8-12'],
    ['Machine Shoulder Press', 3, '8-12'],
    ['Lat Pulldown', 3, '12-20'],
    ['Dumbbell Lateral Raise', 3, '12-20'],
    ['EZ-Bar Curl', 3, '12-20'],
    ['Cable Triceps Pushdown', 3, '12-20'],
  ],
  'Lower Hypertrophy': [
    ['Hack Squat Machine', 4, '8-12'],
    ['Romanian Deadlift', 3, '8-12'],
    ['Leg Extension', 3, '12-20'],
    ['Lying Leg Curl', 3, '12-20'],
    ['Seated Calf Raise', 4, '12-20'],
    ['Hanging Leg Raise', 3, '12-20'],
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
  // ---- EXPANDED SPLITS (2026-07-23). Every preset key is defined in
  // DAY_PRESETS above; weekdays never exceed the day count (tests pin both).
  {
    key: 'bro5full',
    name: 'Bro Split (full seed) · 5 days',
    days: ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs'],
    presets: { Chest: 'Chest', Back: 'Back', Shoulders: 'Shoulders', Arms: 'Arms', Legs: 'Legs' },
    weekdays: [1, 2, 3, 4, 5],
  },
  {
    key: 'arnold6',
    name: 'Arnold Split · 6 days',
    days: ['Chest & Back A', 'Shoulders & Arms A', 'Legs A', 'Chest & Back B', 'Shoulders & Arms B', 'Legs B'],
    presets: {
      'Chest & Back A': 'Chest & Back', 'Shoulders & Arms A': 'Shoulders & Arms', 'Legs A': 'Legs',
      'Chest & Back B': 'Chest & Back', 'Shoulders & Arms B': 'Shoulders & Arms', 'Legs B': 'Legs',
    },
    weekdays: [1, 2, 3, 4, 5, 6],
  },
  {
    key: 'phul4',
    name: 'Power / Hypertrophy Upper-Lower · 4 days',
    days: ['Upper Power', 'Lower Power', 'Upper Hypertrophy', 'Lower Hypertrophy'],
    presets: { 'Upper Power': 'Upper Power', 'Lower Power': 'Lower Power', 'Upper Hypertrophy': 'Upper Hypertrophy', 'Lower Hypertrophy': 'Lower Hypertrophy' },
    weekdays: [1, 2, 4, 5],
  },
  {
    key: 'ppul5',
    name: 'Push / Pull / Legs / Upper / Lower · 5 days',
    days: ['Push', 'Pull', 'Legs', 'Upper', 'Lower'],
    presets: { Push: 'Push', Pull: 'Pull', Legs: 'Legs', Upper: 'Upper', Lower: 'Lower' },
    weekdays: [1, 2, 3, 4, 5],
  },
  {
    key: 'ubro4',
    name: 'Chest&Tri / Back&Bi / Shoulders / Legs · 4 days',
    days: ['Chest & Triceps', 'Back & Biceps', 'Shoulders', 'Legs'],
    presets: { 'Chest & Triceps': 'Chest & Triceps', 'Back & Biceps': 'Back & Biceps', Shoulders: 'Shoulders', Legs: 'Legs' },
    weekdays: [1, 2, 4, 5],
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
