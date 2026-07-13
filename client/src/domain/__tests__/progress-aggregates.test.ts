import { describe, expect, it } from 'vitest';

import {
  exerciseSeries,
  periodTotals,
  timeframeStart,
  weekStart,
} from '../progress-aggregates';
import type { CardioRow, WorkoutRow } from '../summary';

const set = (
  date: string,
  exercise = 'Barbell Bench Press (Strength)',
  weight = 100,
  reps = 5,
  setNo = 1
): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise,
  set: setNo,
  weight,
  reps,
  timestamp: `${date}T10:0${setNo}:00`,
});

const cardio = (date: string, minutes: number): CardioRow => ({
  date,
  type: 'Running',
  minutes,
  distance_km: 0,
  timestamp: `${date}T18:00:00`,
});

describe('weekStart', () => {
  it('a Sunday belongs to the week that began the previous Monday', () => {
    expect(weekStart('2026-07-12')).toBe('2026-07-06'); // Sun -> Mon
  });
  it('a Monday is its own week start', () => {
    expect(weekStart('2026-07-13')).toBe('2026-07-13');
  });
});

describe('timeframeStart', () => {
  it('4W is a 28-day inclusive window', () => {
    expect(timeframeStart('4W', '2026-07-13')).toBe('2026-06-16');
  });
  it('ALL has no floor', () => {
    expect(timeframeStart('ALL', '2026-07-13')).toBeNull();
  });
});

describe('periodTotals', () => {
  const rows = [
    set('2026-07-06', 'Barbell Bench Press (Strength)', 100, 5, 1),
    set('2026-07-06', 'Barbell Bench Press (Strength)', 100, 5, 2),
    set('2026-07-08', 'Barbell Back Squat', 140, 3, 1),
    set('2026-07-02', 'Barbell Back Squat', 120, 3, 1), // before the window
  ];
  const cardios = [cardio('2026-07-07', 30), cardio('2026-07-01', 45)];

  it('counts only rows inside [from, to] and only valid sets', () => {
    const t = periodTotals(rows, cardios, '2026-07-06', '2026-07-12');
    expect(t.sets).toBe(3);
    expect(t.sessions).toBe(2); // 07-06 and 07-08
    expect(t.reps).toBe(13);
    expect(t.volumeKg).toBe(100 * 5 + 100 * 5 + 140 * 3);
    expect(t.cardioMinutes).toBe(30);
  });

  it('XP is activityXp over the period, never a private formula', () => {
    const t = periodTotals(rows, cardios, '2026-07-06', '2026-07-12');
    expect(t.xp).toBe(3 * 10 + 30 * 2); // XP_PER_SET / XP_PER_CARDIO_MINUTE
  });

  it('a zero-weight or zero-rep row is not a set', () => {
    const junk = [set('2026-07-06', 'Barbell Bench Press (Strength)', 0, 5, 1)];
    const t = periodTotals(junk, [], '2026-07-06', '2026-07-12');
    expect(t.sets).toBe(0);
    expect(t.sessions).toBe(0);
    expect(t.xp).toBe(0);
  });

  it('an empty period is honest zeros, not a crash', () => {
    const t = periodTotals([], [], '2026-07-06', '2026-07-12');
    expect(t).toEqual({ sessions: 0, sets: 0, reps: 0, volumeKg: 0, cardioMinutes: 0, xp: 0 });
  });
});

describe('exerciseSeries', () => {
  const rows = [
    set('2026-07-06', 'Barbell Bench Press (Strength)', 100, 5, 1),
    set('2026-07-06', 'Barbell Bench Press (Strength)', 110, 3, 2), // heavier e1RM
    set('2026-07-08', 'Barbell Bench Press (Strength)', 105, 5, 1),
    set('2026-07-08', 'Barbell Back Squat', 140, 3, 1), // other lift
  ];

  it('E1RM takes the best of the day, not the last', () => {
    const s = exerciseSeries(rows, 'Barbell Bench Press (Strength)', 'E1RM', null, '2026-07-13');
    expect(s).toHaveLength(2);
    expect(s[0].date).toBe('2026-07-06');
    // 110x3 beats 100x5 on Epley.
    expect(s[0].value).toBeGreaterThan(115);
  });

  it('VOLUME sums the day; SETS counts it', () => {
    const v = exerciseSeries(rows, 'Barbell Bench Press (Strength)', 'VOLUME', null, '2026-07-13');
    expect(v[0].value).toBe(100 * 5 + 110 * 3);
    const c = exerciseSeries(rows, 'Barbell Bench Press (Strength)', 'SETS', null, '2026-07-13');
    expect(c[0].value).toBe(2);
    expect(c[1].value).toBe(1);
  });

  it('the timeframe floor drops older days', () => {
    const s = exerciseSeries(rows, 'Barbell Bench Press (Strength)', 'E1RM', '2026-07-07', '2026-07-13');
    expect(s.map((p) => p.date)).toEqual(['2026-07-08']);
  });

  it('an untrained exercise is an empty series, not zeros', () => {
    expect(exerciseSeries(rows, 'Overhead Press', 'E1RM', null, '2026-07-13')).toEqual([]);
  });
});
