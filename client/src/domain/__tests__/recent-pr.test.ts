import { describe, expect, it } from 'vitest';

import { recentPr } from '../recent-pr';
import type { WorkoutRow } from '../summary';

const row = (
  date: string,
  exercise: string,
  weight: number,
  reps: number,
  set = 1,
  timestamp = `${date}T10:0${set}:00`
): WorkoutRow => ({ date, workout: 'Push 1', exercise, set, weight, reps, timestamp });

describe('recentPr — set-save’s e1RM rule, replayed chronologically for display', () => {
  it('empty and undefined logs have no PR', () => {
    expect(recentPr(undefined)).toBeNull();
    expect(recentPr([])).toBeNull();
  });

  it('a first-ever set is a baseline, never a record (previousBest must be > 0)', () => {
    expect(recentPr([row('2026-07-01', 'Bench Press', 100, 5)])).toBeNull();
  });

  it('beating the earlier best is a PR; the LATEST one wins the card', () => {
    const pr = recentPr([
      row('2026-07-01', 'Bench Press', 80, 5),
      row('2026-07-05', 'Bench Press', 85, 5), // PR #1
      row('2026-07-14', 'Bench Press', 87.5, 3), // e1RM 96.25 > 99.16? no —
      row('2026-07-15', 'Bench Press', 90, 5), // PR — e1RM 105
    ]);
    expect(pr).toEqual({ exercise: 'Bench Press', weightKg: 90, reps: 5, date: '2026-07-15' });
  });

  it('e1RM decides, not raw weight: more reps at the same load can be the PR', () => {
    const pr = recentPr([
      row('2026-07-01', 'Squat', 100, 3), // e1RM 110
      row('2026-07-08', 'Squat', 100, 8), // e1RM 126.7 — PR
    ]);
    expect(pr).toEqual({ exercise: 'Squat', weightKg: 100, reps: 8, date: '2026-07-08' });
  });

  it('exercises are independent ladders; the newest PR across all of them returns', () => {
    const pr = recentPr([
      row('2026-07-01', 'Bench Press', 80, 5),
      row('2026-07-02', 'Deadlift', 140, 5),
      row('2026-07-10', 'Bench Press', 85, 5), // bench PR
      row('2026-07-12', 'Deadlift', 150, 5), // deadlift PR — newer
    ]);
    expect(pr?.exercise).toBe('Deadlift');
    expect(pr?.date).toBe('2026-07-12');
  });

  it('invalid sets (zero weight or reps) never count, matching the app-wide predicate', () => {
    expect(
      recentPr([
        row('2026-07-01', 'Bench Press', 0, 5),
        row('2026-07-02', 'Bench Press', 80, 0),
        row('2026-07-03', 'Bench Press', 80, 5),
      ])
    ).toBeNull();
  });

  it('an edited set is judged once, at its final values (normalise keeps last)', () => {
    const pr = recentPr([
      row('2026-07-01', 'Bench Press', 80, 5),
      // Same (date, workout, exercise, set) saved twice — the edit wins.
      { ...row('2026-07-05', 'Bench Press', 200, 5, 2, '2026-07-05T10:00:00') },
      { ...row('2026-07-05', 'Bench Press', 82.5, 5, 2, '2026-07-05T10:05:00') },
    ]);
    expect(pr?.weightKg).toBe(82.5);
  });
});
