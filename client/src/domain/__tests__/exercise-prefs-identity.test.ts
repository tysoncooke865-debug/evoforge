import { describe, expect, it } from 'vitest';

import { isFavourite, isHidden, prefSets, unitFor, type ExercisePref } from '../exercise-prefs';
import { passesFilters, rankExercises } from '../exercise-rank';
import type { LibraryExercise } from '../exercise-taxonomy';

/**
 * §21 — A PREFERENCE IS ABOUT THE EXERCISE, NOT THE WORDING.
 *
 * Starring a lift, hiding it, or setting it to pounds are statements about
 * the MOVEMENT. They used to be keyed on the exact string that happened to be
 * on screen, so an AI plan renaming the lift silently dropped all three — and
 * the unit one is the dangerous member of that set: an athlete who works in
 * pounds got a card relabelled to kilos and typed their next set into it.
 *
 * Rows are still STORED by name (that is the table's identity and it does not
 * move). Everything below is about the read, and about keeping two spellings
 * from disagreeing.
 */

const pref = (exercise: string, over: Partial<ExercisePref> = {}): ExercisePref => ({
  exercise,
  is_favourite: false,
  is_hidden: false,
  ...over,
});

const lib = (name: string): LibraryExercise => ({ name, muscle: 'Chest' });

describe('favourites follow identity', () => {
  const rows = [pref('Bench Press', { is_favourite: true })];

  it('a star set under one spelling is lit under another', () => {
    const p = prefSets(rows);
    expect(isFavourite(p, 'Bench Press')).toBe(true);
    expect(isFavourite(p, 'Barbell Bench Press')).toBe(true);
    expect(isFavourite(p, 'Bench Press (Strength Focused)')).toBe(true);
  });

  it('and never lights a DIFFERENT lift', () => {
    const p = prefSets(rows);
    expect(isFavourite(p, 'Incline Barbell Bench Press')).toBe(false);
    expect(isFavourite(p, 'Dumbbell Bench Press')).toBe(false);
    expect(isFavourite(p, 'Barbell Back Squat')).toBe(false);
  });

  it('the FAVOURITES-ONLY filter agrees with the star', () => {
    const ctx = prefSets(rows);
    const isCustom = () => false;
    expect(passesFilters(lib('Barbell Bench Press'), { favouritesOnly: true }, ctx, isCustom)).toBe(true);
    expect(passesFilters(lib('Incline Barbell Bench Press'), { favouritesOnly: true }, ctx, isCustom)).toBe(false);
  });
});

describe('hidden follows identity', () => {
  const rows = [pref('Bench Press', { is_hidden: true })];

  it('hiding a lift hides the exercise, not one wording of it', () => {
    const p = prefSets(rows);
    expect(isHidden(p, 'Barbell Bench Press')).toBe(true);
    expect(isHidden(p, 'Incline Barbell Bench Press')).toBe(false);
  });

  it('a hidden exercise is dropped from an unfiltered search', () => {
    const ctx = prefSets(rows);
    const out = rankExercises([lib('Barbell Bench Press'), lib('Cable Chest Fly')], { query: '', context: ctx });
    expect(out.map((r) => r.exercise.name)).toEqual(['Cable Chest Fly']);
  });

  it('...but typing its name still finds it — hiding is not banning', () => {
    const ctx = prefSets(rows);
    const out = rankExercises([lib('Barbell Bench Press')], { query: 'barbell bench', context: ctx });
    expect(out.map((r) => r.exercise.name)).toEqual(['Barbell Bench Press']);
  });
});

describe('the KG/LB lens follows identity', () => {
  it('pounds set on one spelling stay pounds on another', () => {
    const rows = [pref('Bench Press', { weight_unit: 'lb' })];
    expect(unitFor(rows, 'Bench Press')).toBe('lb');
    expect(unitFor(rows, 'Barbell Bench Press')).toBe('lb');
    expect(unitFor(rows, 'Bench Press - Heavy')).toBe('lb');
  });

  it('and do not leak onto a different lift', () => {
    const rows = [pref('Bench Press', { weight_unit: 'lb' })];
    expect(unitFor(rows, 'Incline Barbell Bench Press')).toBe('kg');
    expect(unitFor(rows, 'Barbell Back Squat')).toBe('kg');
  });

  it('an EXACT row still wins over a sibling — the athlete said so for this one', () => {
    const rows = [
      pref('Bench Press', { weight_unit: 'lb' }),
      pref('Barbell Bench Press', { weight_unit: 'kg' }),
    ];
    expect(unitFor(rows, 'Barbell Bench Press')).toBe('kg');
    expect(unitFor(rows, 'Bench Press')).toBe('lb');
  });

  it('no row at all is still kg', () => {
    expect(unitFor([], 'Barbell Bench Press')).toBe('kg');
    expect(unitFor(undefined, 'Barbell Bench Press')).toBe('kg');
  });
});

describe('the trap a canonical READ would have introduced', () => {
  /**
   * Reading canonically while writing by name is a bug, not a fix: un-starring
   * under a NEW spelling writes `false` on a new row while the old row still
   * says `true`, the canonical read finds the old one, and the star refuses to
   * switch off. The mutations therefore carry every sibling row along. This
   * asserts the shape that makes that possible — two rows for one exercise,
   * agreeing.
   */
  it('two rows for one exercise, both cleared, reads as not starred', () => {
    const p = prefSets([
      pref('Bench Press', { is_favourite: false }),
      pref('Barbell Bench Press', { is_favourite: false }),
    ]);
    expect(isFavourite(p, 'Bench Press')).toBe(false);
    expect(isFavourite(p, 'Barbell Bench Press')).toBe(false);
  });

  it('one row still set keeps it starred — which is why writes must sync siblings', () => {
    const p = prefSets([
      pref('Bench Press', { is_favourite: true }),
      pref('Barbell Bench Press', { is_favourite: false }),
    ]);
    expect(isFavourite(p, 'Barbell Bench Press')).toBe(true);
  });
});
