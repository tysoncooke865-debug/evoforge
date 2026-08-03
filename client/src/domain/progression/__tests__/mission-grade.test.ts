import { describe, expect, it } from 'vitest';

import {
  NEUTRAL,
  PACE_MAX_GAP_S,
  PACE_MIN_SETS,
  gradeFor,
  gradeMission,
  overloadScore,
  paceScore,
  sessionPace,
  sessionVolumeKg,
  type MissionGradeInput,
} from '../mission-grade';

/**
 * A grade is a verdict the app hands an athlete about their own training, so
 * the cases that matter most are the ones where it must REFUSE to judge: a
 * session typed in afterwards, a workout done for the first time, a plan with
 * no target. Every one of those is pinned below.
 */

const base: MissionGradeInput = {
  setsDone: 20,
  setsTarget: 20,
  volumeKg: 12_000,
  previousVolumeKg: 12_000,
  medianGapSeconds: 90,
  prCount: 0,
  streakDays: 0,
};

const at = (secondsFromStart: number[]): string[] =>
  secondsFromStart.map((s) => new Date(Date.UTC(2026, 7, 3, 18, 0, s)).toISOString());

describe('sessionPace', () => {
  it('is the median gap, and reports the session span in minutes', () => {
    // Five sets, gaps of 100/120/110/130 → median 115s, span 460s ≈ 8 min.
    const p = sessionPace(at([0, 100, 220, 330, 460]));
    expect(p).not.toBeNull();
    expect(p!.medianGapSeconds).toBe(115);
    expect(p!.minutes).toBe(8);
    expect(p!.sets).toBe(5);
  });

  it('sorts before measuring — an offline flush can land rows out of order', () => {
    const shuffled = at([220, 0, 460, 100, 330]);
    expect(sessionPace(shuffled)!.medianGapSeconds).toBe(115);
  });

  it(`refuses fewer than ${PACE_MIN_SETS} sets — a median over two gaps is noise`, () => {
    expect(sessionPace(at([0, 100, 220]))).toBeNull();
  });

  it('refuses a session typed in afterwards rather than grading it as rushed', () => {
    // Six rows two seconds apart: bulk entry, not training.
    expect(sessionPace(at([0, 2, 4, 6, 8, 10]))).toBeNull();
  });

  it('refuses when the athlete left and came back', () => {
    const long = PACE_MAX_GAP_S + 60;
    expect(sessionPace(at([0, long, long * 2, long * 3, long * 4]))).toBeNull();
  });

  it('refuses an unparseable or missing stamp instead of dropping it', () => {
    expect(sessionPace(['2026-08-03T18:00:00Z', 'not a date', null, undefined])).toBeNull();
    expect(sessionPace([...at([0, 100, 220]), null])).toBeNull();
  });

  it('accepts epoch millis as well as ISO strings', () => {
    const ms = [0, 100, 220, 330].map((s) => Date.UTC(2026, 7, 3, 18, 0, s));
    expect(sessionPace(ms)!.medianGapSeconds).toBe(110);
  });
});

describe('paceScore', () => {
  it('gives the full mark across the prescribed rest range', () => {
    expect(paceScore(45)).toBe(1);
    expect(paceScore(120)).toBe(1); // the rest timer's own default
    expect(paceScore(180)).toBe(1);
  });

  it('falls off on BOTH sides — rushing and drifting are both worse', () => {
    expect(paceScore(20)).toBeLessThan(1);
    expect(paceScore(20)).toBeGreaterThanOrEqual(0.5);
    expect(paceScore(400)).toBeLessThan(1);
    expect(paceScore(880)).toBeGreaterThanOrEqual(0.4);
  });
});

describe('overloadScore', () => {
  it('scores full only for BEATING the last session', () => {
    expect(overloadScore(10_500, 10_000)).toBe(1);
    expect(overloadScore(10_000, 10_000)).toBe(0.8);
    expect(overloadScore(8_000, 10_000)).toBe(0.25);
  });

  it('goes neutral when there is no previous tonnage to compare', () => {
    expect(overloadScore(10_000, 0)).toBe(NEUTRAL);
  });
});

describe('gradeMission', () => {
  it('S is complete, beaten and well paced — all three', () => {
    const g = gradeMission({ ...base, volumeKg: 13_200 });
    expect(g.score).toBe(100);
    expect(g.grade).toBe('S');
    expect(g.factors.every((f) => f.measured)).toBe(true);
  });

  it('matching last session lands A+, not S — the last points are overload', () => {
    const g = gradeMission(base);
    expect(g.grade).toBe('A+');
    expect(g.score).toBe(95);
  });

  it('a complete first-ever session of a workout still grades A', () => {
    const g = gradeMission({ ...base, previousVolumeKg: null, medianGapSeconds: null });
    expect(g.grade).toBe('A');
    expect(g.score).toBe(82);
    const overload = g.factors.find((f) => f.key === 'overload')!;
    expect(overload.measured).toBe(false);
    expect(overload.detail).toBe('FIRST TIME — NOTHING TO BEAT');
  });

  it('says NOT MEASURED on a factor it could not judge — never silently fills', () => {
    const g = gradeMission({ ...base, medianGapSeconds: null });
    const pace = g.factors.find((f) => f.key === 'pace')!;
    expect(pace.measured).toBe(false);
    expect(pace.detail).toBe('NOT MEASURED');
    expect(pace.earned).toBe(NEUTRAL);
  });

  it('an abandoned session cannot be rescued by PRs or a streak', () => {
    const g = gradeMission({ ...base, setsDone: 4, volumeKg: 20_000, prCount: 3, streakDays: 30 });
    expect(g.grade).toBe('C');
  });

  it('half a session is a B at best', () => {
    const g = gradeMission({ ...base, setsDone: 10 });
    expect(g.grade).toBe('B');
  });

  it('the completion ceiling binds even on a flawless partial session', () => {
    // Beat the volume, perfect pace, two PRs — but only half the sets. The
    // ceiling is 40 + 60 * 0.5 = 70.
    const g = gradeMission({ ...base, setsDone: 10, volumeKg: 20_000, prCount: 2 });
    expect(g.score).toBe(70);
    expect(g.grade).toBe('B');
  });

  it('S still needs the whole mission — 90% caps at A+', () => {
    const g = gradeMission({ ...base, setsDone: 18, volumeKg: 14_000, prCount: 1 });
    expect(g.score).toBeLessThan(96);
    expect(g.grade).toBe('A+');
  });

  it('bonuses are capped and can never exceed 100', () => {
    const g = gradeMission({ ...base, volumeKg: 14_000, prCount: 9, streakDays: 100 });
    expect(g.score).toBe(100);
    expect(g.bonuses.map((b) => b.points)).toEqual([12, 4]);
  });

  it('an ad-hoc workout with no plan target is not punished for having none', () => {
    const g = gradeMission({ ...base, setsTarget: 0, setsDone: 14 });
    const completion = g.factors.find((f) => f.key === 'completion')!;
    expect(completion.earned).toBe(1);
    expect(completion.detail).toBe('14 SETS · NO PLAN TARGET');
  });

  it('logging nothing at all is a C', () => {
    const g = gradeMission({ ...base, setsDone: 0, volumeKg: 0, medianGapSeconds: null });
    expect(g.grade).toBe('C');
  });

  it('the grade ladder is monotonic', () => {
    expect(gradeFor(100)).toBe('S');
    expect(gradeFor(96)).toBe('S');
    expect(gradeFor(95)).toBe('A+');
    expect(gradeFor(89)).toBe('A+');
    expect(gradeFor(88)).toBe('A');
    expect(gradeFor(78)).toBe('A');
    expect(gradeFor(77)).toBe('B');
    expect(gradeFor(62)).toBe('B');
    expect(gradeFor(61)).toBe('C');
    expect(gradeFor(0)).toBe('C');
  });
});

describe('sessionVolumeKg', () => {
  it('is weight times reps over counted sets', () => {
    expect(sessionVolumeKg([{ weight: 100, reps: 5 }, { weight: 80, reps: 10 }])).toBe(1300);
  });

  it('ignores rows that are not sets, and coerces strings like the log does', () => {
    expect(
      sessionVolumeKg([
        { weight: '100', reps: '5' },
        { weight: 60, reps: 0 }, // logged but not performed
        { weight: null, reps: 8 },
        { weight: 50, reps: 'x' },
      ])
    ).toBe(500);
  });

  it('a bodyweight-only session totals zero, which is what sends OVERLOAD neutral', () => {
    const volume = sessionVolumeKg([{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }]);
    expect(volume).toBe(0);
    const g = gradeMission({ ...base, volumeKg: volume, previousVolumeKg: 0 });
    expect(g.factors.find((f) => f.key === 'overload')!.measured).toBe(false);
  });
});
