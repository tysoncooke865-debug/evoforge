import { describe, expect, it } from 'vitest';

import { deriveMission, type MissionInput } from '../home-mission';

const base: MissionInput = {
  hasSchedule: true,
  assignedWorkout: 'Pull 2 - Width / V-Taper',
  adhocWorkout: null,
  finished: false,
  doneSets: 0,
  targetSets: 16,
  loggedSets: 0,
};

describe('deriveMission — one pure decision, the same ingredients as the Train hub', () => {
  it('scheduled: an assigned day, nothing logged, no marker', () => {
    const m = deriveMission(base);
    expect(m.status).toBe('scheduled');
    expect(m.workout).toBe('Pull 2 - Width / V-Taper');
  });

  it('the XP reward IS the ledger grant: 10 per planned set, never a literal', () => {
    expect(deriveMission(base).xpReward).toBe(160);
    expect(deriveMission({ ...base, targetSets: 0 }).xpReward).toBe(0);
  });

  it('in_progress: any valid set banked today flips START to RESUME', () => {
    const m = deriveMission({ ...base, doneSets: 3, loggedSets: 3 });
    expect(m.status).toBe('in_progress');
    expect(m.xpBanked).toBe(30);
  });

  it('in_progress: a started ad-hoc is a commitment even before the first set', () => {
    const m = deriveMission({
      ...base,
      hasSchedule: false,
      assignedWorkout: null,
      adhocWorkout: 'Garage Session',
      targetSets: 0,
    });
    expect(m.status).toBe('in_progress');
    expect(m.workout).toBe('Garage Session');
  });

  it('completed: the finish marker wins over everything, even done < target', () => {
    const m = deriveMission({ ...base, finished: true, doneSets: 9, loggedSets: 11 });
    expect(m.status).toBe('completed');
    // Banked XP counts EVERY logged set — off-plan sets were granted too.
    expect(m.xpBanked).toBe(110);
  });

  it('rest_day: a schedule exists but assigns nothing today', () => {
    const m = deriveMission({ ...base, assignedWorkout: null });
    expect(m.status).toBe('rest_day');
    expect(m.workout).toBeNull();
  });

  it('no_plan: no schedule at all', () => {
    const m = deriveMission({ ...base, hasSchedule: false, assignedWorkout: null });
    expect(m.status).toBe('no_plan');
  });

  it('an assigned day beats a stale ad-hoc name for the CTA target', () => {
    const m = deriveMission({ ...base, adhocWorkout: 'Garage Session' });
    expect(m.workout).toBe('Pull 2 - Width / V-Taper');
    expect(m.status).toBe('scheduled');
  });
});
