import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXERCISE_ALIASES } from '../exercise-aliases';
import { CANONICAL_NAME_BY_ID, EXERCISE_ID_BY_NAME } from '../exercise-ids.generated';
import {
  ALIAS_TARGET_IDS,
  exerciseIdFor,
  normaliseExerciseName,
  resolveExercise,
  sameExercise,
} from '../exercise-identity';
import { EXERCISE_LIBRARY } from '../exercise-library';

/**
 * The acceptance test for canonical exercise identity.
 *
 * The MERGE cases are the feature. The NON-MERGE cases are the guard, and they
 * matter more: a missing alias costs a little history, while a wrong one puts
 * an athlete's incline and flat bench numbers in one graph and there is no way
 * to tell afterwards which set was which. Every mechanical distinction the
 * spec names gets an explicit assertion here.
 */

const idOf = (name: string) => resolveExercise(name).exerciseId;

describe('normalisation', () => {
  it('folds case, punctuation and apostrophes; keeps digits', () => {
    expect(normaliseExerciseName('Barbell Bench Press')).toBe('barbell bench press');
    expect(normaliseExerciseName('Close-Grip  Bench Press')).toBe('close grip bench press');
    expect(normaliseExerciseName("Farmer's Walk")).toBe('farmers walk');
    expect(normaliseExerciseName('45 Degree Leg Press')).toBe('45 degree leg press');
    expect(normaliseExerciseName('  ')).toBe('');
  });

  it('matches the generator byte for byte', () => {
    // A generator that normalises differently emits a map the resolver can
    // never hit — silently, and only for the names where they disagree.
    const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'gen-exercise-ids.mjs'), 'utf8');
    const body = /const normalise = \(s\) =>([\s\S]*?)\n\nconst slug/.exec(script);
    expect(body, 'gen-exercise-ids.mjs no longer has the expected normalise()').not.toBeNull();
    const samples = [
      'Barbell Bench Press', "Farmer's Walk", 'Low-to-High Incline Cable Fly',
      'Seated/Lying Leg Curl', 'T-Bar Row', '45 Degree Leg Press', 'EZ-Bar Curl',
      'Skull Crusher (Lying Triceps Extension)', '90/90 Hamstring',
    ];
    const theirs = new Function(`return (s) => ${(body as RegExpExecArray)[1].trim().replace(/;$/, '')}`)() as (
      s: string
    ) => string;
    for (const s of samples) expect(theirs(s)).toBe(normaliseExerciseName(s));
  });
});

describe('the generated catalogue', () => {
  it('is non-empty and covers the library', () => {
    // A guard that cannot fail is not a guard: assert there is data before
    // asserting things about it.
    expect(Object.keys(EXERCISE_ID_BY_NAME).length).toBeGreaterThan(900);
    expect(Object.keys(CANONICAL_NAME_BY_ID).length).toBe(Object.keys(EXERCISE_ID_BY_NAME).length);
  });

  it('has an id for every library exercise — regenerate on drift', () => {
    const missing = EXERCISE_LIBRARY.filter(
      (e) => EXERCISE_ID_BY_NAME[normaliseExerciseName(e.name)] === undefined
    ).map((e) => e.name);
    expect(missing, 'run `node scripts/gen-exercise-ids.mjs`').toEqual([]);
  });

  it('never maps two different names onto one id', () => {
    const seen = new Map<string, string>();
    for (const [name, id] of Object.entries(EXERCISE_ID_BY_NAME)) {
      expect(seen.has(id), `id collision '${id}': '${seen.get(id)}' vs '${name}'`).toBe(false);
      seen.set(id, name);
    }
  });
});

describe('the alias table', () => {
  it('only points at ids that exist', () => {
    expect(ALIAS_TARGET_IDS.length).toBeGreaterThan(0);
    for (const id of ALIAS_TARGET_IDS) {
      expect(CANONICAL_NAME_BY_ID[id], `alias target '${id}' is not a catalogue exercise`).toBeTruthy();
    }
  });

  it('never lists one alias under two different exercises', () => {
    const owner = new Map<string, string>();
    for (const [id, aliases] of Object.entries(EXERCISE_ALIASES)) {
      for (const a of aliases) {
        const key = normaliseExerciseName(a);
        expect(owner.has(key), `alias '${a}' claimed by both ${owner.get(key)} and ${id}`).toBe(false);
        owner.set(key, id);
      }
    }
  });
});

describe('§22 — exercise identity, the cases the spec names', () => {
  it('a prescription descriptor never mints a new exercise', () => {
    expect(idOf('Bench Press (Strength Focused)')).toBe('barbell_bench_press');
    expect(idOf('Bench Press - Heavy')).toBe('barbell_bench_press');
    expect(idOf('Bench Press — 5x5')).toBe('barbell_bench_press');
    expect(idOf('Bench Press (Power)')).toBe('barbell_bench_press');
    expect(idOf('Bench Press: 3 x 10')).toBe('barbell_bench_press');
    expect(idOf('Barbell Bench Press (Top Set)')).toBe('barbell_bench_press');
    expect(idOf('Lat Pulldown (Hypertrophy Focus)')).toBe('lat_pulldown');
  });

  it('the bare name and the full name are one exercise', () => {
    expect(sameExercise('Bench Press', 'Barbell Bench Press')).toBe(true);
    expect(sameExercise('Flat Bench Press', 'Bench Press - Heavy')).toBe(true);
    expect(sameExercise('RDL', 'Romanian Deadlift')).toBe(true);
    expect(sameExercise('Lat Pull Down', 'Lat Pulldown')).toBe(true);
  });

  it('MECHANICAL differences stay different exercises', () => {
    // The four the spec calls out by name.
    expect(sameExercise('Incline Barbell Bench Press', 'Bench Press')).toBe(false);
    expect(sameExercise('Dumbbell Bench Press', 'Barbell Bench Press')).toBe(false);
    expect(sameExercise('Incline Dumbbell Bench Press', 'Incline Barbell Bench Press')).toBe(false);
    expect(sameExercise('Smith Machine Bench Press', 'Barbell Bench Press')).toBe(false);
    expect(sameExercise('Close-Grip Bench Press', 'Barbell Bench Press')).toBe(false);
    // And the pulldown pair the spec says NOT to assume.
    expect(sameExercise('Wide Grip Lat Pulldown', 'Close-Grip Lat Pulldown')).toBe(false);
    expect(sameExercise('Close-Grip Lat Pulldown', 'Lat Pulldown')).toBe(false);
  });

  it('never strips a mechanical qualifier that happens to trail', () => {
    // Each of these has a real, distinct catalogue identity.
    expect(idOf('Incline Bench Press')).toBe('incline_barbell_bench_press');
    expect(idOf('Paused Barbell Bench Press')).toBe('paused_barbell_bench_press');
    // A bracketed segment that is not ALL prescription words is left alone.
    expect(idOf('Cable Lat Pullover (Straight-Arm Pulldown)')).toBe(
      'cable_lat_pullover_straight_arm_pulldown'
    );
    expect(idOf('Skull Crusher (Lying Triceps Extension)')).toBe(
      'skull_crusher_lying_triceps_extension'
    );
    expect(idOf('Reverse Pec Deck (Rear Delt Fly)')).toBe('reverse_pec_deck_rear_delt_fly');
  });

  it('a hyphenated NAME is never split at its hyphen', () => {
    expect(idOf('Close-Grip Bench Press')).toBe('close_grip_bench_press');
    expect(idOf('Low-to-High Incline Cable Fly')).toBe('low_to_high_incline_cable_fly');
    expect(idOf('T-Bar Row')).toBe('t_bar_row');
  });

  it('peels more than one descriptor', () => {
    expect(idOf('Bench Press (Strength) - Heavy')).toBe('barbell_bench_press');
    expect(idOf('Lat Pulldown [Volume] (Week 3)')).toBe('lat_pulldown');
  });
});

describe('unknown names', () => {
  it('get a stable id and merge with NOTHING', () => {
    const a = idOf('Tyson Special Crusher');
    expect(a).toBe('name_tyson_special_crusher');
    expect(idOf('tyson  special   crusher')).toBe(a);
    expect(sameExercise('Tyson Special Crusher', 'Barbell Bench Press')).toBe(false);
  });

  it('keep the descriptor when nothing recognised the stem', () => {
    // We only claim a descriptor was decoration when the stem resolved.
    expect(idOf('Zercher Widowmaker (Heavy)')).toBe('name_zercher_widowmaker_heavy');
  });

  it('a plain pull-up is not a weighted or assisted one', () => {
    expect(idOf('Pull-Up')).toBe('name_pull_up');
    expect(sameExercise('Pull-Up', 'Weighted Pull-Up')).toBe(false);
    expect(sameExercise('Pull-Up', 'Assisted Pull-Up')).toBe(false);
  });

  it('an empty name resolves to nothing rather than to something', () => {
    expect(resolveExercise('   ')).toEqual({ exerciseId: '', canonicalName: '', source: 'unknown' });
  });
});

describe('§12 — custom exercises', () => {
  const mine = [{ id: '11111111-2222-3333-4444-555555555555', name: 'Tyson Cable Crossover Hold' }];

  it('get a permanent id from their own row', () => {
    const r = resolveExercise('Tyson Cable Crossover Hold', mine);
    expect(r.exerciseId).toBe('custom_11111111-2222-3333-4444-555555555555');
    expect(r.source).toBe('custom');
  });

  it('do not duplicate on capitalisation or spacing', () => {
    expect(exerciseIdFor('tyson  cable crossover  hold', mine)).toBe(
      exerciseIdFor('Tyson Cable Crossover Hold', mine)
    );
  });

  it('resolve by id even when the name is gone', () => {
    const r = resolveExercise({ exerciseId: 'custom_11111111-2222-3333-4444-555555555555' }, mine);
    expect(r.canonicalName).toBe('Tyson Cable Crossover Hold');
  });

  it('a custom name that IS a library exercise keeps the library identity', () => {
    // Deliberate: an athlete who typed "Bench Press" into CREATE should not be
    // detached from four years of bench history by that act.
    const r = resolveExercise('Bench Press', [{ id: 'abc', name: 'Bench Press' }]);
    expect(r.exerciseId).toBe('barbell_bench_press');
  });
});

describe('explicit ids from a model', () => {
  it('an id the catalogue knows is taken at face value', () => {
    const r = resolveExercise({ exerciseId: 'barbell_bench_press', name: 'Bench Press (Strength)' });
    expect(r.exerciseId).toBe('barbell_bench_press');
    expect(r.canonicalName).toBe('Barbell Bench Press');
    expect(r.source).toBe('id');
  });

  it('an INVENTED id falls back to resolving the name, never to itself', () => {
    // The whole point: a model may not mint an identity by writing one down.
    const r = resolveExercise({ exerciseId: 'bench_press_strength_focus', name: 'Bench Press' });
    expect(r.exerciseId).toBe('barbell_bench_press');
  });

  it('an invented id with an unknown name still cannot become that id', () => {
    const r = resolveExercise({ exerciseId: 'super_press_9000', name: 'Super Press 9000' });
    expect(r.exerciseId).toBe('name_super_press_9000');
  });
});
