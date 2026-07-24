import type { ExercisePref } from '@/data/exercise-prefs';
import type { Routine } from '@/data/routines';
import type { UserPlans } from '@/data/user-plans';
import type { UserExercise } from '@/domain/exercise-search';
import type { SourceIndex } from '@/domain/plan-sources';

/**
 * Plans and exercise personalisation. The lab athlete follows the BUILT-IN
 * split (source 2) with no custom/AI plan — MY PLAN and AI PLAN deliberately
 * read empty so a variant shows the honest empty states too. One saved
 * routine and one custom exercise prove the personalised surfaces.
 */

export const LAB_PLAN_SOURCE_PREF: SourceIndex = 2;

export const LAB_USER_PLANS: UserPlans = { custom: null, ai: null };

export const LAB_USER_EXERCISES: UserExercise[] = [
  { id: 'lab-ux-1', name: 'Lab Cable Crossover', muscle: 'Chest' },
];

export const LAB_EXERCISE_PREFS: ExercisePref[] = [
  {
    exercise: 'Barbell Bench Press (Strength)',
    is_favourite: true,
    is_hidden: false,
    weight_unit: 'kg',
  },
];

export function labRoutines(todayIso: string): Routine[] {
  return [
    {
      id: 'lab-routine-1',
      name: 'Quick Pump',
      payload: {
        version: 1,
        exercises: [
          { exercise: 'Dumbbell Flat Bench Press', sets: 3, reps: '10-12' },
          { exercise: 'Lab Cable Crossover', sets: 3, reps: '12-15' },
        ],
      },
      created_at: `${todayIso}T00:00:00`,
    },
  ];
}
