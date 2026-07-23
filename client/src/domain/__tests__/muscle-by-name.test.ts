import { describe, expect, it } from 'vitest';

import { EXERCISE_LIBRARY, libraryMuscleFor } from '../exercise-library';
import { MUSCLE_BY_NAME } from '../muscle-by-name.generated';
import { libraryMuscleFor as lookupMuscleFor } from '../muscle-lookup';

const REGEN = 'DRIFT — regenerate: node scripts/gen-muscle-by-name.mjs';

describe('muscle-by-name.generated', () => {
  it('is exactly the library projection (last duplicate wins)', () => {
    // The same construction the old exercise-library BY_NAME used.
    const expected = new Map(EXERCISE_LIBRARY.map((e) => [e.name.trim().toLowerCase(), e.muscle]));
    // A guard that cannot fail is not a guard: prove both sides are real.
    expect(expected.size).toBeGreaterThan(1000);
    expect(Object.keys(MUSCLE_BY_NAME).length, REGEN).toBe(expected.size);
    for (const [name, muscle] of expected) {
      expect(MUSCLE_BY_NAME[name], `${name}: ${REGEN}`).toBe(muscle);
    }
  });

  it('libraryMuscleFor (both export sites) reads the projection', () => {
    // exercise-library re-exports the lookup — one implementation, two doors.
    expect(libraryMuscleFor).toBe(lookupMuscleFor);
    expect(libraryMuscleFor('Barbell Bench Press')).toBe('Chest');
    expect(libraryMuscleFor('  landmine 180’s  ')).toBe('Abs');
    expect(libraryMuscleFor("Farmer's Walk")).toBe('Forearms');
    expect(libraryMuscleFor('No Such Exercise Ever')).toBeNull();
  });
});
