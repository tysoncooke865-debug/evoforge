import { describe, expect, it } from 'vitest';

import { normaliseWorkoutLog } from '../summary';
import { buildWorkoutIndex, dwKey, lastSessionForWorkout } from '../workout-index';

const row = (date: string, workout: string, exercise: string, weight: number, reps: number, set = 1) => ({
  id: `${date}-${workout}-${exercise}-${set}`,
  date,
  workout,
  exercise,
  set,
  weight,
  reps,
  timestamp: `${date}T10:0${set}:00`,
});

describe('buildWorkoutIndex — one scan, shared lookups (B1/B3)', () => {
  const rows = [
    row('2026-07-18', 'Push', 'Bench', 100, 5),
    row('2026-07-18', 'Push', 'Bench', 100, 5, 2),
    row('2026-07-18', 'Push', 'Warmup', 0, 10, 3), // counted (061)
    row('2026-07-18', 'Push', 'Ghost', 50, 0, 4), // NOT counted
    row('2026-07-19', 'Pull', 'Row', 60, 8),
  ];
  const idx = buildWorkoutIndex(rows);

  it('rows are exactly the normalised log (parity)', () => {
    expect(idx.rows).toEqual(normaliseWorkoutLog(rows as never));
  });

  it('byDate and byDateWorkout partition without loss', () => {
    expect(idx.byDate.get('2026-07-18')).toHaveLength(4);
    expect(idx.byDateWorkout.get(dwKey('2026-07-18', 'Push'))).toHaveLength(4);
    expect(idx.byDateWorkout.get(dwKey('2026-07-19', 'Pull'))).toHaveLength(1);
    const total = [...idx.byDate.values()].reduce((n, a) => n + a.length, 0);
    expect(total).toBe(idx.rows.length);
  });

  it('countedByDateWorkout applies the 061 rule (0 kg in, 0 reps out)', () => {
    const counted = idx.countedByDateWorkout.get(dwKey('2026-07-18', 'Push')) ?? [];
    expect(counted).toHaveLength(3); // two bench + the bodyweight warmup
    expect(counted.some((r) => String(r.exercise) === 'Ghost')).toBe(false);
  });

  it('null/empty input → empty index, never a throw', () => {
    const empty = buildWorkoutIndex(null);
    expect(empty.rows).toEqual([]);
    expect(empty.byDate.size).toBe(0);
  });
});

describe('lastSessionForWorkout — index-backed twin of lastSessionWork', () => {
  const rows = [
    row('2026-07-10', 'Push', 'Bench', 100, 5),
    row('2026-07-10', 'Push', 'Bench', 100, 5, 2),
    row('2026-07-15', 'Push', 'Bench', 105, 4),
    row('2026-07-15', 'Push', 'Warmup', 0, 10, 2), // counted
    row('2026-07-15', 'Push', 'Ghost', 50, 0, 3), // NOT counted
    row('2026-07-20', 'Push', 'Bench', 110, 3), // today / after
  ];
  const idx = buildWorkoutIndex(rows);

  it('returns the most recent COUNTED session strictly before the date', () => {
    // Before 2026-07-20 → the 07-15 session: 2 counted sets (Bench 4 + Warmup 10).
    expect(lastSessionForWorkout(idx, 'Push', '2026-07-20')).toEqual({ sets: 2, totalReps: 14 });
  });

  it('excludes the current/after date and unknown workouts', () => {
    // Before 2026-07-15 → the 07-10 session (2 sets, 10 reps).
    expect(lastSessionForWorkout(idx, 'Push', '2026-07-15')).toEqual({ sets: 2, totalReps: 10 });
    expect(lastSessionForWorkout(idx, 'Push', '2026-07-10')).toBeNull(); // nothing before
    expect(lastSessionForWorkout(idx, 'Legs', '2026-07-20')).toBeNull(); // unknown
    expect(lastSessionForWorkout(null, 'Push', '2026-07-20')).toBeNull();
  });
});
