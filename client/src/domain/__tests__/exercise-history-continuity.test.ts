import { describe, expect, it } from 'vitest';

import { canonicalisePlan } from '../custom-plan';
import { digestHistory, lastPerformanceLabel } from '../exercise-history';
import { lastPerformance, prefillForSet } from '../last-performance';
import { recentPr } from '../recent-pr';
import { decideSetSave, previousBest1rm } from '../set-save';
import type { WorkoutRow } from '../summary';

/**
 * §8 / §10 / §22 — HISTORY BELONGS TO THE EXERCISE.
 *
 * The identity resolver is unit-tested next door (exercise-identity.test.ts).
 * This file asserts the thing an athlete actually experiences: that the same
 * canonical exercise carries ONE history across every workout type, whatever
 * wording produced the row — and that two different exercises still carry two.
 *
 * Every row below is written the way the app writes them, through the same
 * pure functions the logger, the picker, Home and the PR pipeline call.
 */

const TODAY = '2026-08-10';

const row = (
  date: string,
  exercise: string,
  set: number,
  weight: number,
  reps: number,
  workout = 'Push 1 - Strength'
): WorkoutRow => ({
  date,
  workout,
  exercise,
  set,
  weight,
  reps,
  timestamp: `${date}T10:0${set}:00`,
});

/** The history an athlete built under the plain name, months ago. */
const BENCH_HISTORY: WorkoutRow[] = [
  row('2026-07-20', 'Bench Press', 1, 80, 8),
  row('2026-07-20', 'Bench Press', 2, 80, 7),
  row('2026-07-20', 'Bench Press', 3, 75, 9),
];

describe('§22 — an AI rename does not erase the athlete', () => {
  it('"Bench Press (Strength Focused)" finds "Bench Press"', () => {
    const last = lastPerformance(BENCH_HISTORY, 'Bench Press (Strength Focused)', TODAY);
    expect(last?.date).toBe('2026-07-20');
    expect(last?.sets).toMatchObject([
      { set: 1, weight: 80, reps: 8 },
      { set: 2, weight: 80, reps: 7 },
      { set: 3, weight: 75, reps: 9 },
    ]);
  });

  it('"Bench Press - Heavy" finds "Barbell Bench Press"', () => {
    const rows = [row('2026-07-20', 'Barbell Bench Press', 1, 80, 8)];
    expect(lastPerformance(rows, 'Bench Press - Heavy', TODAY)?.sets[0]).toMatchObject({
      weight: 80,
      reps: 8,
    });
  });

  it('"Lat Pulldown (Hypertrophy Focus)" finds "Lat Pulldown"', () => {
    const rows = [row('2026-07-20', 'Lat Pulldown', 1, 60, 12)];
    expect(lastPerformance(rows, 'Lat Pulldown (Hypertrophy Focus)', TODAY)).not.toBeNull();
  });

  it('INCLINE history never shows up on a flat bench', () => {
    const rows = [row('2026-07-20', 'Incline Barbell Bench Press', 1, 70, 8)];
    expect(lastPerformance(rows, 'Bench Press', TODAY)).toBeNull();
  });

  it('DUMBBELL history never shows up on a barbell lift', () => {
    const rows = [row('2026-07-20', 'Dumbbell Bench Press', 1, 32.5, 10)];
    expect(lastPerformance(rows, 'Barbell Bench Press', TODAY)).toBeNull();
  });

  it('a wide-grip pulldown is not a close-grip one', () => {
    const rows = [row('2026-07-20', 'Wide Grip Lat Pulldown', 1, 60, 12)];
    expect(lastPerformance(rows, 'Close-Grip Lat Pulldown', TODAY)).toBeNull();
  });
});

describe('§9 — the prefill follows the history', () => {
  it('a renamed exercise prefills last time`s numbers, per set', () => {
    const last = lastPerformance(BENCH_HISTORY, 'Bench Press (Strength Focused)', TODAY);
    expect(prefillForSet(last, 1)).toMatchObject({ weight: 80, reps: 8 });
    expect(prefillForSet(last, 3)).toMatchObject({ weight: 75, reps: 9 });
    // Beyond what was done last time, the last set carries forward — the
    // pre-existing rule, unchanged.
    expect(prefillForSet(last, 4)).toMatchObject({ weight: 75, reps: 9 });
  });
});

describe('§10 — one history across every workout type', () => {
  const mixed: WorkoutRow[] = [
    row('2026-07-20', 'Bench Press', 1, 80, 8, 'Monday Push'),
    row('2026-07-27', 'Barbell Bench Press', 1, 82.5, 8, 'Friday Quick Workout'),
    row('2026-08-03', 'Bench Press (Strength Focused)', 1, 85, 6, 'AI Strength Day'),
  ];

  it('all three sessions are the same exercise', () => {
    const last = lastPerformance(mixed, 'Flat Bench Press', TODAY);
    expect(last?.date).toBe('2026-08-03');
    expect(last?.sets[0]).toMatchObject({ weight: 85, reps: 6 });
  });

  it('the PR baseline sees every one of them', () => {
    // The best e1RM across all three spellings is the QUICK WORKOUT's
    // 82.5 x 8 (104.5), not the heaviest bar — which is the point: asked
    // under any of the three names, the baseline is the same number. A
    // name-keyed lookup returned only whichever spelling happened to match,
    // and for the AI's spelling that was zero.
    const expected = 82.5 * (1 + 8 / 30);
    expect(previousBest1rm(mixed, 'Bench Press - Heavy')).toBeCloseTo(expected, 6);
    expect(previousBest1rm(mixed, 'Bench Press (Strength Focused)')).toBeCloseTo(expected, 6);
    expect(previousBest1rm(mixed, 'Barbell Bench Press')).toBeCloseTo(expected, 6);
    // And an exercise that is genuinely different still has no baseline.
    expect(previousBest1rm(mixed, 'Incline Barbell Bench Press')).toBe(0);
  });

  it('a set that does NOT beat the merged history is not crowned a PR', () => {
    // The bug this closes: against a name-fragmented history, 82.5 x 8 looked
    // like a record because the 85 kg session was filed under another string.
    const verdict = decideSetSave(mixed, {
      workoutDate: TODAY,
      workout: 'AI Strength Day',
      exercise: 'Bench Press (Strength Focused)',
      setNo: 1,
      weight: 82.5,
      reps: 8,
    });
    expect(verdict.action).toBe('insert');
    expect((verdict as { is_pr: boolean }).is_pr).toBe(false);
  });

  it('a set that genuinely beats it still is', () => {
    const verdict = decideSetSave(mixed, {
      workoutDate: TODAY,
      workout: 'AI Strength Day',
      exercise: 'Bench Press (Strength Focused)',
      setNo: 1,
      weight: 100,
      reps: 5,
    });
    expect((verdict as { is_pr: boolean }).is_pr).toBe(true);
  });

  it('Home reads the same records the logger does', () => {
    // Chronologically: 80x8 is the baseline, 82.5x8 beats it (a real PR), and
    // 85x6 does NOT (102 < 104.5) however heavy the bar looked. Keyed by name,
    // that last set was the first ever set of a brand-new exercise and Home
    // would have said nothing at all; keyed by identity it is judged against
    // the athlete's actual best, and correctly refused.
    const pr = recentPr(mixed);
    expect(pr?.date).toBe('2026-07-27');
    expect(pr?.weightKg).toBe(82.5);
  });
});

describe('a stored exercise_id (migration 192) is preferred over the name', () => {
  it('a backfilled row answers without resolving', () => {
    // `exercise_id` is not on WorkoutRow — summary.ts is byte-sensitive (it
    // uses literal NULs as dedupe-key separators) and reading a column the
    // type does not name is exactly what `r as WorkoutRow & {...}` is for.
    const stored = [
      { ...row('2026-07-20', 'Whatever The Import Called It', 1, 80, 8), exercise_id: 'barbell_bench_press' },
    ] as unknown as WorkoutRow[];
    expect(lastPerformance(stored, 'Bench Press', TODAY)?.sets[0]).toMatchObject({ weight: 80 });
  });
});

describe('the picker`s "Last:" line', () => {
  it('answers for a renamed exercise', () => {
    const history = digestHistory(BENCH_HISTORY);
    expect(lastPerformanceLabel(history, 'Bench Press')).toBe('Last: 75 kg × 9');
    expect(lastPerformanceLabel(history, 'Barbell Bench Press')).toBe('Last: 75 kg × 9');
    expect(lastPerformanceLabel(history, 'Incline Barbell Bench Press')).toBeNull();
  });

  it('records that the athlete has performed the canonical exercise', () => {
    const history = digestHistory(BENCH_HISTORY);
    expect(history.performedIds.has('barbell_bench_press')).toBe(true);
    expect(history.performedIds.has('incline_barbell_bench_press')).toBe(false);
  });
});

describe('§12 — a custom exercise keeps its own history', () => {
  const mine = [{ id: '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', name: 'Tyson Crossover Hold' }];
  const rows = [row('2026-07-20', 'Tyson Crossover Hold', 1, 15, 30)];

  it('resolves by its permanent id, whatever the case', () => {
    expect(lastPerformance(rows, 'tyson crossover hold', TODAY, mine)?.sets[0]).toMatchObject({
      weight: 15,
    });
  });

  it('merges with nothing else', () => {
    expect(lastPerformance(rows, 'Cable Chest Fly', TODAY, mine)).toBeNull();
  });
});

describe('§4 / §5 — a prescription can never become an identity', () => {
  const plan = {
    plan_name: 'Forged',
    days: [
      {
        day: 'Push 1 - Strength',
        goal: 'press',
        exercises: [
          { exercise: 'Bench Press (Strength Focused)', sets: 4, reps: '4-6', reason: '' },
          { exercise: 'Lat Pulldown - Heavy', sets: 3, reps: '8-12', reason: '' },
          { exercise: 'Tyson Special Crusher', sets: 3, reps: '10', reason: '' },
        ],
      },
    ],
  };

  it('rewrites the display name to the catalogue name and keeps the intent', () => {
    const out = canonicalisePlan(plan);
    const [bench, pulldown] = out.days[0].exercises;
    expect(bench.exercise).toBe('Barbell Bench Press');
    expect(bench.exerciseId).toBe('barbell_bench_press');
    // The word "Strength" was not deleted — it moved somewhere honest.
    expect(bench.trainingFocus).toBe('strength');
    expect(pulldown.exercise).toBe('Lat Pulldown');
    expect(pulldown.exerciseId).toBe('lat_pulldown');
  });

  it('leaves a name it cannot identify EXACTLY as written', () => {
    const out = canonicalisePlan(plan);
    const custom = out.days[0].exercises[2];
    expect(custom.exercise).toBe('Tyson Special Crusher');
    expect(custom.exerciseId).toBeUndefined();
  });

  it('does not touch the prescription it was given', () => {
    const out = canonicalisePlan(plan);
    expect(out.days[0].exercises[0]).toMatchObject({ sets: 4, reps: '4-6' });
    expect(out.plan_name).toBe('Forged');
    expect(out.days).toHaveLength(1);
  });

  it('is idempotent — canonicalising twice changes nothing', () => {
    const once = canonicalisePlan(plan);
    expect(canonicalisePlan(once)).toEqual(once);
  });
});
