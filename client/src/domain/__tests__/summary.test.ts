import { describe, expect, it } from 'vitest';

import { BENCH_EXERCISE, normaliseWorkoutLog, workoutSummary } from '../summary';

const set = (over: Record<string, unknown> = {}) => ({
  date: '2026-07-10',
  workout: 'Push 1 - Strength',
  exercise: BENCH_EXERCISE,
  set: 1,
  weight: 80,
  reps: 5,
  timestamp: '2026-07-10T10:00:00',
  ...over,
});

describe('normaliseWorkoutLog', () => {
  it('dedupes on (date, workout, exercise, set) keeping the LAST by timestamp', () => {
    // save_set_auto updates in place; a stale duplicate must lose to the
    // newest write, exactly like pandas drop_duplicates(keep="last").
    const rows = normaliseWorkoutLog([
      set({ weight: 100, timestamp: '2026-07-10T11:00:00' }),
      set({ weight: 60, timestamp: '2026-07-10T09:00:00' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBe(100);
  });

  it('different set numbers are different rows', () => {
    expect(normaliseWorkoutLog([set({ set: 1 }), set({ set: 2 })])).toHaveLength(2);
  });

  it('coerces set to int like pandas to_numeric().astype(int)', () => {
    const rows = normaliseWorkoutLog([set({ set: '3' })]);
    expect(rows[0].set).toBe(3);
  });
});

describe('workoutSummary', () => {
  it('empty logs at base level 1: level 1, 0/500', () => {
    const s = workoutSummary([], [], null, 1);
    expect(s).toMatchObject({
      totalSets: 0,
      totalReps: 0,
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpNeeded: 500,
      xpSource: 'derived',
      xpDrift: 0,
    });
  });

  it('counts sets by the 061 rule (weight >= 0 AND reps > 0)', () => {
    const s = workoutSummary(
      [set(), set({ set: 2, weight: 0 }), set({ set: 3, reps: 0 })],
      [],
      null,
      1
    );
    // 061: the 0 kg (bodyweight) set counts; the 0-rep one never does.
    expect(s.totalSets).toBe(2);
    expect(s.xpDerived).toBe(20); // two sets × XP_PER_SET
  });

  it('a duplicated set earns XP once — the double-grant bug class', () => {
    const s = workoutSummary(
      [set({ weight: 60 }), set({ weight: 80, timestamp: '2026-07-10T11:00:00' })],
      [],
      null,
      1
    );
    expect(s.totalSets).toBe(1);
    expect(s.xpDerived).toBe(10);
  });

  it('bench e1RM comes only from the named bench exercise', () => {
    const s = workoutSummary(
      [set({ weight: 100, reps: 5 }), set({ set: 2, exercise: 'Barbell Back Squat', weight: 180, reps: 5 })],
      [],
      null,
      1
    );
    // 100 * (1 + 5/30)
    expect(s.bestBench1rm).toBeCloseTo(116.6666, 3);
  });

  it('cardio minutes add 2 XP each and duplicates collapse', () => {
    const run = { date: '2026-07-10', type: 'Run', minutes: 30, distance_km: 5, timestamp: 't1' };
    const s = workoutSummary([set()], [run, { ...run }], null, 1);
    expect(s.cardioMinutes).toBe(30);
    expect(s.xpDerived).toBe(10 + 60);
  });

  it('ledger null means derived; ledger 0 with earned XP means drift (never a level drop)', () => {
    const rows = [set()];
    const withNull = workoutSummary(rows, [], null, 1);
    expect(withNull.xpSource).toBe('derived');
    expect(withNull.xp).toBe(10);

    const withZero = workoutSummary(rows, [], 0, 1);
    // The ledger is behind: display floors at derived, drift is reported.
    expect(withZero.xp).toBe(10);
    expect(withZero.xpSource).toBe('derived (ledger behind)');
    expect(withZero.xpDrift).toBe(-10);
  });

  it('the ledger wins when at or ahead', () => {
    const s = workoutSummary([set()], [], 150, 1);
    expect(s.xp).toBe(150);
    expect(s.xpSource).toBe('ledger');
    expect(s.xpDrift).toBe(140);
  });

  it('starts at base level with 0 XP toward the next, not at level 1', () => {
    const s = workoutSummary([], [], null, 42);
    expect(s.level).toBe(42);
    expect(s.xpNeeded).toBe(500 + 41 * 25);
  });
});
