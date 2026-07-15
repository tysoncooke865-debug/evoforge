import { describe, expect, it } from 'vitest';

import { estimateMinutes, estimateNetKcal, lastSessionWork, splitWorkoutName } from '../workout-estimates';

describe('estimateMinutes — sets × (45s work + 120s rest), to the nearest 5', () => {
  it('20 sets ≈ 55 min (the spec anchor: 20 × 165s = 3300s exactly)', () => {
    expect(estimateMinutes(20)).toBe(55);
  });

  it('18 sets → 49.5 min raw → 50 on the display grid', () => {
    expect(estimateMinutes(18)).toBe(50);
  });

  it('a tiny workout still reads 5, never 0 minutes', () => {
    expect(estimateMinutes(1)).toBe(5);
  });

  it('no sets → no estimate', () => {
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(-3)).toBe(0);
    expect(estimateMinutes(Number.NaN)).toBe(0);
  });
});

describe('estimateNetKcal — the SURPLUS over resting: (MET−1) work + (MET−1) rest', () => {
  it('20 sets at 77 kg, no rep history: (5×15 + 0.5×40) × 1.3475 = 128.0 → 130', () => {
    expect(estimateNetKcal(20, null, 77)).toBe(130);
  });

  it('20 sets at 77 kg, 10 reps/set: work shrinks to 13.33 min → 116.8 → 120', () => {
    expect(estimateNetKcal(20, 10, 77)).toBe(120);
  });

  it('net is well below the old gross number (370 for the same day)', () => {
    expect(estimateNetKcal(20, null, 77)).toBeLessThan(370);
  });

  it('heavier athlete burns more (positive control on the kg term)', () => {
    expect(estimateNetKcal(20, 10, 100)).toBeGreaterThan(estimateNetKcal(20, 10, 62));
  });

  it('more reps per set costs more (positive control on the reps term)', () => {
    expect(estimateNetKcal(20, 20, 77)).toBeGreaterThan(estimateNetKcal(20, 8, 77));
  });

  it('reps-per-set clamps to [3, 30] — outliers behave as the bounds', () => {
    expect(estimateNetKcal(20, 2, 77)).toBe(estimateNetKcal(20, 3, 77));
    expect(estimateNetKcal(20, 40, 77)).toBe(estimateNetKcal(20, 30, 77));
  });

  it('no sets or no bodyweight → 0, never NaN', () => {
    expect(estimateNetKcal(0, 10, 77)).toBe(0);
    expect(estimateNetKcal(10, null, 0)).toBe(0);
    expect(estimateNetKcal(10, 10, Number.NaN)).toBe(0);
  });
});

describe('lastSessionWork — the latest COMPLETED session strictly before today', () => {
  const PUSH = 'Push 1 - Strength';
  const rows = [
    { date: '2026-07-13', workout: PUSH, exercise: 'Bench', weight: 60, reps: 8 },
    { date: '2026-07-13', workout: PUSH, exercise: 'Bench', weight: '60', reps: '7' }, // wire strings coerce
    { date: '2026-07-13', workout: PUSH, exercise: 'OHP', weight: 40, reps: 10 },
    { date: '2026-07-06', workout: PUSH, exercise: 'Bench', weight: 55, reps: 12 }, // older session loses
    { date: '2026-07-13', workout: PUSH, exercise: 'Fly', weight: 0, reps: 12 }, // invalid: no weight
    { date: '2026-07-13', workout: 'Pull 1 - Strength', exercise: 'Row', weight: 50, reps: 10 },
    { date: '2026-07-15', workout: PUSH, exercise: 'Bench', weight: 62, reps: 8 }, // today: in progress
  ];

  it('the fixture is non-empty (a guard that cannot fail is not a guard)', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('picks 2026-07-13: 3 valid sets, 25 total reps — not today, not the older one', () => {
    expect(lastSessionWork(rows, PUSH, '2026-07-15')).toEqual({ sets: 3, totalReps: 25 });
  });

  it('with the 13th excluded (beforeDate earlier), the older session surfaces', () => {
    expect(lastSessionWork(rows, PUSH, '2026-07-13')).toEqual({ sets: 1, totalReps: 12 });
  });

  it('a workout with no history → null, never a zero-set session', () => {
    expect(lastSessionWork(rows, 'Legs - Volume', '2026-07-15')).toBeNull();
    expect(lastSessionWork([], PUSH, '2026-07-15')).toBeNull();
  });

  it('history that is ONLY today → null (an in-progress session is not "last workout")', () => {
    const todayOnly = [{ date: '2026-07-15', workout: PUSH, exercise: 'Bench', weight: 60, reps: 8 }];
    expect(lastSessionWork(todayOnly, PUSH, '2026-07-15')).toBeNull();
  });
});

describe('splitWorkoutName — the FIRST " - " splits title from sub', () => {
  it('the spec example', () => {
    expect(splitWorkoutName('Push 2 - Hypertrophy')).toEqual({ title: 'Push 2', sub: 'Hypertrophy' });
  });

  it('a single-word day has no sub', () => {
    expect(splitWorkoutName('Legs')).toEqual({ title: 'Legs', sub: null });
  });

  it('only the first separator splits — the rest stays in the sub', () => {
    expect(splitWorkoutName('A - B - C')).toEqual({ title: 'A', sub: 'B - C' });
  });

  it('a plain hyphen is not a separator (Full-Body is one word)', () => {
    expect(splitWorkoutName('Full-Body Blast')).toEqual({ title: 'Full-Body Blast', sub: null });
  });

  it('a degenerate " - Something" name survives whole', () => {
    expect(splitWorkoutName(' - Hypertrophy')).toEqual({ title: '- Hypertrophy', sub: null });
  });
});

// musclePillsFor moved to domain/muscle-map.ts as pillLabelsFor — pills and
// the body map share one fine-grained vocabulary; tests live there.
