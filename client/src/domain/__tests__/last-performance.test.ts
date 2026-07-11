import { describe, expect, it } from 'vitest';

import { lastPerformance, prefillForSet } from '../last-performance';
import type { WorkoutRow } from '../summary';

const row = (date: string, exercise: string, set: number, weight: number, reps: number): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise,
  set,
  weight,
  reps,
  timestamp: `${date}T10:0${set}:00`,
});

const TODAY = '2026-07-12';

describe('lastPerformance', () => {
  it('empty history → null', () => {
    expect(lastPerformance([], 'Bench', TODAY)).toBeNull();
  });

  it('finds the most recent PRIOR session with per-set values', () => {
    const rows = [
      row('2026-07-01', 'Bench', 1, 60, 8),
      row('2026-07-08', 'Bench', 1, 70, 5),
      row('2026-07-08', 'Bench', 2, 72.5, 5),
      row('2026-07-05', 'Bench', 1, 65, 6),
    ];
    const last = lastPerformance(rows, 'Bench', TODAY);
    expect(last?.date).toBe('2026-07-08');
    expect(last?.sets).toEqual([
      { set: 1, weight: 70, reps: 5 },
      { set: 2, weight: 72.5, reps: 5 },
    ]);
  });

  it("today's rows are excluded — an in-progress session never prefills itself", () => {
    const rows = [row(TODAY, 'Bench', 1, 100, 5)];
    expect(lastPerformance(rows, 'Bench', TODAY)).toBeNull();
  });

  it('other exercises and invalid (zero) sets never leak in', () => {
    const rows = [
      row('2026-07-08', 'Squat', 1, 120, 5),
      row('2026-07-08', 'Bench', 1, 0, 5), // invalid: no weight
      row('2026-07-08', 'Bench', 2, 60, 0), // invalid: no reps
    ];
    expect(lastPerformance(rows, 'Bench', TODAY)).toBeNull();
  });
});

describe('prefillForSet', () => {
  const last = {
    date: '2026-07-08',
    sets: [
      { set: 1, weight: 70, reps: 5 },
      { set: 2, weight: 72.5, reps: 4 },
    ],
  };

  it('same set number wins', () => {
    expect(prefillForSet(last, 2)).toEqual({ weight: 72.5, reps: 4 });
  });

  it('fewer prior sets than target → falls back to the last set', () => {
    expect(prefillForSet(last, 4)).toEqual({ weight: 72.5, reps: 4 });
  });

  it('null history → null', () => {
    expect(prefillForSet(null, 1)).toBeNull();
  });
});
