import { describe, expect, it } from 'vitest';

import {
  loggedAllPppplaDays,
  muscleSetsCount,
  sweepAchievements,
  uniqueTrainingDays,
  type SweepInputs,
} from '../achievements';
import { ACHIEVEMENTS } from '../catalogs';
import type { WorkoutRow } from '../summary';

const empty = (): SweepInputs => ({
  workoutRows: [],
  totalSets: 0,
  bestBench1rm: 0,
  level: 1,
  heat: new Map(),
  bw: { latest: null, min: null, max: null, count: 0 },
  bf: { latest: null, count: 0 },
  cardio: { minutes: 0, distance: 0, count: 0, types: new Set() },
  bfTarget: null,
});

const row = (over: Partial<WorkoutRow> = {}): WorkoutRow => ({
  date: '2026-07-11',
  workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)',
  set: 1,
  weight: 80,
  reps: 5,
  timestamp: 't',
  ...over,
});

describe('sweepAchievements', () => {
  it('empty athlete earns nothing — the vacuous-guard control', () => {
    expect(sweepAchievements(empty(), new Set())).toEqual([]);
  });

  it('every id it emits exists in the catalog', () => {
    const inputs = {
      ...empty(),
      totalSets: 5000,
      bestBench1rm: 200,
      level: 100,
      heat: new Map([
        ['Chest', 500], ['Upper Chest', 100], ['Back Width', 500], ['Side Delts', 500],
        ['Biceps', 500], ['Quads', 500], ['Abs', 500],
      ]),
      bw: { latest: 90, min: 70, max: 95, count: 10 },
      bf: { latest: 9, count: 3 },
      cardio: { minutes: 2000, distance: 150, count: 20, types: new Set(['Boxing', 'Run']) },
      bfTarget: 12,
      workoutRows: [
        row({ weight: 130, reps: 3 }),
        row({ exercise: 'Barbell Back Squat', set: 2, weight: 210, reps: 3 }),
      ],
    };
    const ids = sweepAchievements(inputs, new Set());
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) expect(id in ACHIEVEMENTS, id).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates in one sweep
  });

  it('already-held achievements are never re-emitted', () => {
    const inputs = { ...empty(), totalSets: 1 };
    expect(sweepAchievements(inputs, new Set())).toEqual(['first_set']);
    expect(sweepAchievements(inputs, new Set(['first_set']))).toEqual([]);
  });

  it('bench WEIGHT thresholds read raw max weight; e1RM ones read the summary best', () => {
    const inputs = {
      ...empty(),
      totalSets: 1,
      bestBench1rm: 99, // below bench_100_est
      workoutRows: [row({ weight: 100, reps: 0 })], // invalid set, but max weight 100
    };
    const ids = sweepAchievements(inputs, new Set(['first_set']));
    expect(ids).toContain('bench_100'); // raw weight
    expect(ids).not.toContain('bench_100_est'); // e1RM short
  });

  it('squat-to-bodyweight uses squat e1RM', () => {
    const inputs = {
      ...empty(),
      workoutRows: [row({ exercise: 'Barbell Back Squat', weight: 140, reps: 8 })], // e1RM 177.3
      bw: { latest: 85, min: 85, max: 85, count: 1 },
    };
    const ids = sweepAchievements(inputs, new Set(['first_bw_log', 'bw_85', 'bw_80', 'squat_100', 'squat_140']));
    expect(ids).toContain('squat_2_bw'); // 177.3 >= 170
  });

  it('bf target hit needs both a reading and a target', () => {
    const base = { ...empty(), bf: { latest: 11, count: 1 }, bfTarget: null };
    expect(sweepAchievements(base, new Set(['first_bf_log', 'bf_under_15', 'bf_under_13', 'bf_under_12']))).toEqual([]);
    const withTarget = { ...base, bfTarget: 12 };
    expect(
      sweepAchievements(withTarget, new Set(['first_bf_log', 'bf_under_15', 'bf_under_13', 'bf_under_12']))
    ).toEqual(['bf_target_hit']);
  });
});

describe('helpers', () => {
  it('uniqueTrainingDays counts distinct dates', () => {
    expect(
      uniqueTrainingDays([row(), row({ set: 2 }), row({ date: '2026-07-12' })])
    ).toBe(2);
  });

  it('loggedAllPppplaDays needs all six days', () => {
    const five = ['Push 1 - Strength', 'Pull 1 - Back Thickness', 'Push 2 - Hypertrophy', 'Pull 2 - Width / V-Taper', 'Legs'];
    expect(loggedAllPppplaDays(five.map((w) => row({ workout: w })))).toBe(false);
    expect(loggedAllPppplaDays([...five, 'Aesthetics'].map((w) => row({ workout: w })))).toBe(true);
  });

  it('muscleSetsCount sums only the named groups', () => {
    const heat = new Map([['Chest', 30], ['Upper Chest', 25], ['Quads', 99]]);
    expect(muscleSetsCount(heat, ['Chest', 'Upper Chest'])).toBe(55);
  });
});
