import { describe, expect, it } from 'vitest';

import { EXERCISE_LIBRARY } from '../exercise-library';
import { MINE, muscleOptions, searchExercises, userMuscleFor } from '../exercise-search';

const MY_LIFT = { id: 'u1', name: 'Jefferson Curl', muscle: 'Hamstrings' };

describe('searchExercises', () => {
  it('an empty query returns the whole library, grouped (positive control)', () => {
    const r = searchExercises('');
    expect(r.count).toBe(EXERCISE_LIBRARY.length);
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.hasExactMatch).toBe(false); // nothing to match yet
  });

  it('matches on NAME, case-insensitively', () => {
    const r = searchExercises('bulgarian');
    expect(r.count).toBe(1);
    expect(r.sections[0].exercises[0].name).toBe('Bulgarian Split Squat');
  });

  it('matches on MUSCLE too — "triceps" finds the triceps work', () => {
    const r = searchExercises('triceps');
    expect(r.count).toBeGreaterThan(5);
    expect(r.sections.some((s) => s.label === 'Arms')).toBe(true);
  });

  it('a miss returns nothing to pick (and so offers CREATE)', () => {
    const r = searchExercises('zercher yoke carry');
    expect(r.count).toBe(0);
    expect(r.hasExactMatch).toBe(false);
  });

  it("the athlete's own exercises come first, under MINE", () => {
    const r = searchExercises('curl', [MY_LIFT]);
    expect(r.sections[0].label).toBe(MINE);
    expect(r.sections[0].exercises[0].name).toBe('Jefferson Curl');
    // and the library's curls are still there
    expect(r.count).toBeGreaterThan(1);
  });

  it('hasExactMatch guards CREATE against minting a duplicate', () => {
    // 016's unique index is case-insensitive; the picker must not offer to
    // create something the database will then reject.
    expect(searchExercises('Face Pull').hasExactMatch).toBe(true);
    expect(searchExercises('face pull').hasExactMatch).toBe(true);
    expect(searchExercises('  FACE PULL  ').hasExactMatch).toBe(true);
    expect(searchExercises('Face Pulls').hasExactMatch).toBe(false);
    // ...including against the athlete's OWN names
    expect(searchExercises('jefferson curl', [MY_LIFT]).hasExactMatch).toBe(true);
  });

  it('a partial hit is not an exact match — "bench" can still be created', () => {
    const r = searchExercises('bench');
    expect(r.count).toBeGreaterThan(0);
    expect(r.hasExactMatch).toBe(false);
  });
});

describe('userMuscleFor', () => {
  it("the athlete's own definition wins — they told us", () => {
    expect(userMuscleFor('Jefferson Curl', [MY_LIFT])).toBe('Hamstrings');
    expect(userMuscleFor('jefferson curl', [MY_LIFT])).toBe('Hamstrings');
  });

  it('null when unknown, so the caller falls back to inferMuscleGroup', () => {
    expect(userMuscleFor('Barbell Bench Press', [MY_LIFT])).toBeNull();
    expect(userMuscleFor('Anything', [])).toBeNull();
  });
});

describe('muscleOptions', () => {
  it('offers every section, and every tag belongs to one', () => {
    const opts = muscleOptions();
    expect(opts.length).toBeGreaterThan(0);
    const tags = new Set(opts.flatMap((o) => o.muscles));
    // Every muscle the library actually uses must be offerable, or a custom
    // exercise could never be tagged to match its built-in neighbours.
    for (const e of EXERCISE_LIBRARY) {
      expect(tags.has(e.muscle)).toBe(true);
    }
  });
});
