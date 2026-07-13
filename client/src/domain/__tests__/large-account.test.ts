import { describe, expect, it } from 'vitest';

import { periodTotals, exerciseSeries, weekStart } from '../progress-aggregates';
import { computeScheduledStreak, weeklyContract, type ScheduleRow } from '../scheduled-streak';
import { normaliseWorkoutLog, workoutSummary, type CardioRow, type WorkoutRow } from '../summary';
import { XP_PER_SET } from '../xp';

/**
 * TRANSFORM P8 — the large-account fixture. The audit flagged that summary
 * and stats recompute over up to 2,500 rows per render, and that a heavy
 * account is the case nobody tests. This builds one (5,000 valid sets over
 * ~3.4 years, six exercises, plus cardio) and pins BOTH:
 *
 *   correctness — the totals are exactly what the generator put in, and the
 *   pure functions agree with each other; and
 *
 *   cost — each hot path stays well inside a per-render budget. The numbers
 *   are deliberately loose (an order of magnitude over what a dev machine
 *   measures) so this fails on an algorithmic regression — an accidental
 *   O(n²) — and not on a slow CI runner.
 */

const EXERCISES = [
  'Barbell Bench Press (Strength)',
  'Barbell Back Squat',
  'Deadlift',
  'Lat Pulldown',
  'Overhead Press',
  'Barbell Row',
];

const SETS_PER_DAY = 5;
const DAYS = 1000; // 5,000 sets
const START = Date.UTC(2023, 0, 2); // a Monday

const iso = (dayIndex: number): string =>
  new Date(START + dayIndex * 86_400_000).toISOString().slice(0, 10);

function buildAccount(): { workouts: WorkoutRow[]; cardio: CardioRow[] } {
  const workouts: WorkoutRow[] = [];
  const cardio: CardioRow[] = [];
  for (let d = 0; d < DAYS; d++) {
    const date = iso(d);
    const exercise = EXERCISES[d % EXERCISES.length];
    for (let s = 1; s <= SETS_PER_DAY; s++) {
      workouts.push({
        id: `${d}-${s}`,
        date,
        workout: 'Push 1 - Strength',
        exercise,
        set: s,
        // Deterministic, weight climbs slowly — no Math.random: a flaky
        // fixture is worse than no fixture.
        weight: 60 + (d % 40) + s,
        reps: 5,
        timestamp: `${date}T10:0${s}:00`,
      });
    }
    if (d % 3 === 0) {
      cardio.push({ date, type: 'Running', minutes: 30, distance_km: 5, timestamp: `${date}T18:00:00` });
    }
  }
  return { workouts, cardio };
}

const { workouts, cardio } = buildAccount();
const TOTAL_SETS = DAYS * SETS_PER_DAY;
const TOTAL_CARDIO_MIN = Math.ceil(DAYS / 3) * 30;
const LAST_DAY = iso(DAYS - 1);

/** Wall-clock of one call, in ms. */
const timed = (fn: () => unknown): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe('large account: 5,000 sets', () => {
  it('the fixture is actually large (a fixture that shrank silently proves nothing)', () => {
    expect(workouts).toHaveLength(TOTAL_SETS);
    expect(cardio.length).toBeGreaterThan(300);
  });

  it('normaliseWorkoutLog keeps every distinct set — dedupe must not eat rows', () => {
    expect(normaliseWorkoutLog(workouts)).toHaveLength(TOTAL_SETS);
  });

  it('workoutSummary counts every set and mints XP by the contract', () => {
    const s = workoutSummary(workouts, cardio, null, 1);
    expect(s.totalSets).toBe(TOTAL_SETS);
    expect(s.cardioMinutes).toBe(TOTAL_CARDIO_MIN);
    // Derived XP is the golden formula, not a re-derivation here.
    expect(s.xpDerived).toBe(TOTAL_SETS * XP_PER_SET + TOTAL_CARDIO_MIN * 2);
    expect(s.level).toBeGreaterThan(1);
  });

  it('periodTotals over the whole history agrees with the summary', () => {
    const t = periodTotals(workouts, cardio, iso(0), LAST_DAY);
    expect(t.sets).toBe(TOTAL_SETS);
    expect(t.sessions).toBe(DAYS);
    expect(t.cardioMinutes).toBe(TOTAL_CARDIO_MIN);
  });

  it('the weekly window slices a heavy account down to one week', () => {
    const t = periodTotals(workouts, cardio, weekStart(LAST_DAY), LAST_DAY);
    expect(t.sessions).toBeLessThanOrEqual(7);
    expect(t.sets).toBeLessThanOrEqual(7 * SETS_PER_DAY);
  });

  it('exerciseSeries returns one point per training day for that lift', () => {
    const series = exerciseSeries(workouts, EXERCISES[0], 'E1RM', null, LAST_DAY);
    // Every 6th day is exercise 0.
    expect(series.length).toBe(Math.ceil(DAYS / EXERCISES.length));
    expect(series[0].value).toBeGreaterThan(0);
  });

  it('the scheduled streak and contract survive a 3-year history', () => {
    const schedule: ScheduleRow[] = [
      {
        effective_from: iso(0),
        plan: { '0': 'Rest', '1': 'Push 1 - Strength', '2': 'Push 1 - Strength', '3': 'Push 1 - Strength', '4': 'Push 1 - Strength', '5': 'Push 1 - Strength', '6': 'Push 1 - Strength' },
      },
    ];
    const streak = computeScheduledStreak(schedule, workouts, LAST_DAY);
    expect(streak.current).toBeGreaterThan(0);
    const contract = weeklyContract(schedule, workouts, LAST_DAY);
    expect(contract.pips).toHaveLength(7);
    expect(contract.done).toBeGreaterThan(0);
  });

  // COST. Budgets are ~10x a dev-machine measurement: they catch an
  // accidental O(n^2), not a busy runner.
  it('workoutSummary stays inside the per-render budget', () => {
    expect(timed(() => workoutSummary(workouts, cardio, null, 1))).toBeLessThan(400);
  });

  it('periodTotals stays inside the per-render budget', () => {
    expect(timed(() => periodTotals(workouts, cardio, iso(0), LAST_DAY))).toBeLessThan(400);
  });

  it('exerciseSeries stays inside the per-render budget', () => {
    expect(timed(() => exerciseSeries(workouts, EXERCISES[0], 'VOLUME', null, LAST_DAY))).toBeLessThan(400);
  });

  it('computeScheduledStreak over a 180-day window stays inside budget', () => {
    const schedule: ScheduleRow[] = [
      { effective_from: iso(0), plan: { '0': 'Rest', '1': 'Push 1 - Strength', '2': 'Push 1 - Strength', '3': 'Push 1 - Strength', '4': 'Push 1 - Strength', '5': 'Push 1 - Strength', '6': 'Push 1 - Strength' } },
    ];
    expect(timed(() => computeScheduledStreak(schedule, workouts, LAST_DAY))).toBeLessThan(400);
  });
});
