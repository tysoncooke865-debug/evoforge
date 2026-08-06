import { describe, expect, it } from 'vitest';

import type { LibraryExercise } from '../exercise-taxonomy';
import { EXERCISE_LIBRARY } from '../exercise-library';
import { inferMuscleGroup } from '../workouts';
import {
  exerciseCountFor,
  expandMuscleTargets,
  recommendStarter,
  targetMusclesFromText,
  type StarterRequest,
} from '../recommend-starter';

/**
 * THE COMPLAINT THIS ANSWERS (Tyson, 2026-08-06): a Shoulders-focused starter
 * session was prefilled with Ab Wheel Rollout, Arnold Press, Assisted Pull-Up,
 * Barbell Back Squat, Barbell Bench Press and Barbell Bent-Over Row — the
 * alphabetical head of the library, one shoulder movement in six.
 */

const LIB: LibraryExercise[] = [
  { name: 'Ab Wheel Rollout', muscle: 'Abs', equipment: 'Other', category: 'Isolation', difficulty: 'Advanced', popularity: 40 },
  { name: 'Arnold Press', muscle: 'Shoulders', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Intermediate', popularity: 60 },
  { name: 'Assisted Pull-Up', muscle: 'Lats', equipment: 'Machine', category: 'Compound', difficulty: 'Beginner', popularity: 55 },
  { name: 'Barbell Back Squat', muscle: 'Quadriceps', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 95 },
  { name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 98 },
  { name: 'Barbell Bent-Over Row', muscle: 'Back', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 90 },
  { name: 'Dumbbell Shoulder Press', muscle: 'Shoulders', equipment: 'Dumbbell', category: 'Compound', difficulty: 'Beginner', popularity: 88 },
  { name: 'Dumbbell Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 92 },
  { name: 'Cable Face Pull', muscle: 'Traps', equipment: 'Cable', category: 'Isolation', difficulty: 'Beginner', secondary: ['Shoulders'], popularity: 70 },
  { name: 'Barbell Overhead Press', muscle: 'Shoulders', equipment: 'Barbell', category: 'Compound', difficulty: 'Intermediate', popularity: 85 },
  { name: 'Dumbbell Shrug', muscle: 'Traps', equipment: 'Dumbbell', category: 'Isolation', difficulty: 'Beginner', popularity: 65 },
  { name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Beginner', popularity: 80 },
  { name: 'Bodyweight Squat', muscle: 'Quadriceps', equipment: 'Bodyweight', category: 'Compound', difficulty: 'Beginner', popularity: 78 },
  { name: 'Band Pull-Apart', muscle: 'Shoulders', equipment: 'Band', category: 'Isolation', difficulty: 'Beginner', popularity: 50 },
  { name: 'Plank', muscle: 'Abs', equipment: 'Bodyweight', category: 'Isolation', difficulty: 'Beginner', popularity: 75 },
];

const req = (over: Partial<StarterRequest> = {}): StarterRequest => ({
  goal: 'build_muscle',
  experience: 'new',
  equipment: 'full_gym',
  sessionMinutes: 45,
  targetMuscles: [],
  library: LIB,
  ...over,
});

describe('a shoulders session is a shoulders session', () => {
  const picks = recommendStarter(req({ targetMuscles: ['Shoulders'] }));
  const names = picks.map((p) => p.exercise);

  it('every exercise trains shoulders, primarily or as a secondary', () => {
    for (const n of names) {
      const e = LIB.find((x) => x.name === n)!;
      const trains = e.muscle === 'Shoulders' || (e.secondary ?? []).includes('Shoulders');
      expect(trains, `${n} does not train shoulders`).toBe(true);
    }
  });

  it('THE ORIGINAL BUG: no squat and no bench in a shoulder workout', () => {
    expect(names).not.toContain('Barbell Back Squat');
    expect(names).not.toContain('Barbell Bench Press');
    expect(names).not.toContain('Ab Wheel Rollout');
  });

  it('is a manageable amount of volume, not a wall', () => {
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names.length).toBeLessThanOrEqual(5);
    const sets = picks.reduce((n, p) => n + p.sets, 0);
    expect(sets).toBeLessThanOrEqual(20);
  });

  it('sequences compounds before isolation', () => {
    const cats = names.map((n) => LIB.find((x) => x.name === n)!.category);
    const lastCompound = cats.lastIndexOf('Compound');
    const firstIsolation = cats.indexOf('Isolation');
    if (lastCompound >= 0 && firstIsolation >= 0) expect(lastCompound).toBeLessThan(firstIsolation);
  });
});

describe('it respects what the athlete told onboarding', () => {
  it('EQUIPMENT: bodyweight-only never offers a barbell or a machine', () => {
    const picks = recommendStarter(req({ equipment: 'bodyweight', targetMuscles: [] }));
    for (const p of picks) {
      const e = LIB.find((x) => x.name === p.exercise)!;
      expect(['Bodyweight', 'Band']).toContain(e.equipment);
    }
    expect(picks.length).toBeGreaterThan(0);
  });

  it('EQUIPMENT: home kit allows dumbbells but still no barbell', () => {
    const picks = recommendStarter(req({ equipment: 'home_basic', targetMuscles: ['Shoulders'] }));
    for (const p of picks) {
      const e = LIB.find((x) => x.name === p.exercise)!;
      expect(e.equipment).not.toBe('Barbell');
      expect(e.equipment).not.toBe('Machine');
    }
  });

  it('EXPERIENCE: a beginner is never given an Advanced movement', () => {
    const picks = recommendStarter(req({ experience: 'new', targetMuscles: [] }));
    for (const p of picks) {
      expect(LIB.find((x) => x.name === p.exercise)!.difficulty).not.toBe('Advanced');
    }
  });

  it('GOAL drives the rep range', () => {
    expect(recommendStarter(req({ goal: 'get_stronger' }))[0].reps).toBe('4-6');
    expect(recommendStarter(req({ goal: 'build_muscle' }))[0].reps).toBe('8-12');
    expect(recommendStarter(req({ goal: 'lose_fat' }))[0].reps).toBe('10-15');
  });

  it('SESSION LENGTH and EXPERIENCE set the size', () => {
    expect(exerciseCountFor(30, 'experienced')).toBe(3);
    expect(exerciseCountFor(45, 'experienced')).toBe(4);
    expect(exerciseCountFor(60, 'experienced')).toBe(5);
    expect(exerciseCountFor(90, 'experienced')).toBe(6);
    // A beginner is capped whatever the clock says.
    expect(exerciseCountFor(90, 'new')).toBe(4);
    expect(exerciseCountFor(null, null)).toBe(4);
  });

  it('a full-body session spreads across muscles rather than stacking one', () => {
    const picks = recommendStarter(req({ targetMuscles: [], experience: 'consistent', sessionMinutes: 60 }));
    const muscles = picks.map((p) => LIB.find((x) => x.name === p.exercise)!.muscle);
    expect(new Set(muscles).size).toBe(muscles.length);
  });
});

describe('robustness', () => {
  it('never returns an excluded exercise', () => {
    const picks = recommendStarter(req({ targetMuscles: ['Shoulders'], exclude: ['Dumbbell Shoulder Press'] }));
    expect(picks.map((p) => p.exercise)).not.toContain('Dumbbell Shoulder Press');
  });

  it('returns nothing rather than nonsense when the library is empty', () => {
    expect(recommendStarter(req({ library: [] }))).toEqual([]);
  });

  it('returns nothing for a target no exercise trains, instead of padding with junk', () => {
    expect(recommendStarter(req({ targetMuscles: ['Tail'] }))).toEqual([]);
  });

  it('is deterministic', () => {
    const a = recommendStarter(req({ targetMuscles: ['Shoulders'] }));
    const b = recommendStarter(req({ targetMuscles: ['Shoulders'] }));
    expect(a).toEqual(b);
  });
});

/**
 * AGAINST THE REAL LIBRARY. The fixture above cannot catch a VOCABULARY
 * mismatch, and that is exactly what shipped: `inferMuscleGroup` returns the
 * coarse "Shoulders" while the 960-exercise library tags "Front Delts",
 * "Side Delts" and "Rear Delts". Five exercises carry the plain tag, so a
 * Shoulders session came back EMPTY in the browser while every fixture test
 * passed. These run on the real data.
 */
describe('the real 960-exercise library', () => {
  it('a coarse "Shoulders" target expands to the delt tags the library uses', () => {
    const t = expandMuscleTargets(['Shoulders']);
    expect(t.has('front delts')).toBe(true);
    expect(t.has('side delts')).toBe(true);
    expect(t.has('rear delts')).toBe(true);
  });

  it('builds a real shoulders session — the case that returned nothing', () => {
    const picks = recommendStarter({
      goal: 'build_muscle',
      experience: 'new',
      equipment: 'full_gym',
      sessionMinutes: 45,
      targetMuscles: ['Shoulders'],
      library: EXERCISE_LIBRARY,
    });
    expect(picks.length).toBeGreaterThanOrEqual(3);
    const shoulderTags = expandMuscleTargets(['Shoulders']);
    for (const p of picks) {
      const e = EXERCISE_LIBRARY.find((x) => x.name === p.exercise)!;
      const onTarget =
        shoulderTags.has(e.muscle.toLowerCase()) ||
        (e.secondary ?? []).some((m) => shoulderTags.has(m.toLowerCase()));
      expect(onTarget, `${p.exercise} (${e.muscle}) is not a shoulders movement`).toBe(true);
    }
  });

  it('every coarse group the picker offers yields a real session', () => {
    for (const group of ['Chest', 'Back', 'Legs', 'Arms', 'Shoulders', 'Core']) {
      const picks = recommendStarter({
        goal: 'build_muscle',
        experience: 'consistent',
        equipment: 'full_gym',
        sessionMinutes: 60,
        targetMuscles: [group],
        library: EXERCISE_LIBRARY,
      });
      expect(picks.length, `${group} produced nothing`).toBeGreaterThanOrEqual(3);
    }
  });

  it('bodyweight-only still produces a full-body session from the real library', () => {
    const picks = recommendStarter({
      goal: 'improve_fitness',
      experience: 'new',
      equipment: 'bodyweight',
      sessionMinutes: 30,
      targetMuscles: [],
      library: EXERCISE_LIBRARY,
    });
    expect(picks.length).toBeGreaterThanOrEqual(3);
    for (const p of picks) {
      const e = EXERCISE_LIBRARY.find((x) => x.name === p.exercise)!;
      if (e.equipment) expect(['Bodyweight', 'Band']).toContain(e.equipment);
    }
  });
});

/**
 * THE WIRING BUG THE UNIT TESTS COULD NOT SEE. The sheet passed the typed
 * session name through `inferMuscleGroup`, which reads EXERCISE names. Given
 * the word "Shoulders" it answers "Other" — a tag no exercise carries — so
 * the prefill returned an empty session even though every test above passed.
 * Found in a browser; pinned here.
 */
describe('turning a typed session name into muscle targets', () => {
  const infer = inferMuscleGroup;

  it('"Shoulders" is the muscle group, not the exercise-name fallback "Other"', () => {
    const t = targetMusclesFromText('Shoulders', infer);
    expect(t.length).toBeGreaterThan(0);
    expect(t.map((x) => x.toLowerCase())).not.toContain('other');
  });

  it('resolves a real session from a typed group name, end to end', () => {
    for (const typed of ['Shoulders', 'Chest', 'Back', 'Legs', 'Shoulder Day']) {
      const targets = targetMusclesFromText(typed, infer);
      const picks = recommendStarter({
        goal: 'build_muscle',
        experience: 'consistent',
        equipment: 'full_gym',
        sessionMinutes: 60,
        targetMuscles: targets,
        library: EXERCISE_LIBRARY,
      });
      expect(picks.length, `"${typed}" produced nothing`).toBeGreaterThanOrEqual(3);
    }
  });

  it('an exercise name still infers its muscle', () => {
    expect(targetMusclesFromText('Barbell Bench Press', infer).length).toBeGreaterThan(0);
  });

  it('an unrecognisable name means FULL BODY, never an empty session', () => {
    expect(targetMusclesFromText('', infer)).toEqual([]);
    const picks = recommendStarter({
      goal: 'build_muscle',
      experience: 'consistent',
      equipment: 'full_gym',
      sessionMinutes: 60,
      targetMuscles: targetMusclesFromText('zzzz', infer),
      library: EXERCISE_LIBRARY,
    });
    expect(picks.length).toBeGreaterThanOrEqual(3);
  });
});
