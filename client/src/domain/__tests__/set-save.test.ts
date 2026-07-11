import { describe, expect, it } from 'vitest';

import { decideSetSave, previousBest1rm } from '../set-save';
import type { WorkoutRow } from '../summary';

const stored = (over: Partial<WorkoutRow> = {}): WorkoutRow => ({
  id: 'row-1',
  date: '2026-07-11',
  workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)',
  set: 1,
  weight: 80,
  reps: 5,
  timestamp: '2026-07-11T10:00:00',
  ...over,
});

const input = (over: Partial<Parameters<typeof decideSetSave>[1]> = {}) => ({
  workoutDate: '2026-07-11',
  workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)',
  setNo: 1,
  weight: 80,
  reps: 5,
  ...over,
});

describe('decideSetSave', () => {
  it('rejects non-positive weight or reps', () => {
    expect(decideSetSave([], input({ weight: 0 })).action).toBe('reject');
    expect(decideSetSave([], input({ reps: 0 })).action).toBe('reject');
    expect(decideSetSave([], input({ weight: -5 })).action).toBe('reject');
  });

  it('identical stored values are a no-op — no write, no grant, no toast', () => {
    const v = decideSetSave([stored()], input());
    expect(v.action).toBe('noop');
  });

  it('an EDIT updates in place by id — the double-grant invariant', () => {
    const v = decideSetSave([stored()], input({ weight: 85 }));
    expect(v).toMatchObject({ action: 'update', rowId: 'row-1' });
  });

  it('the edit targets the LAST duplicate, matching keep-last semantics', () => {
    const v = decideSetSave(
      [
        stored({ id: 'older', timestamp: '2026-07-11T09:00:00' }),
        stored({ id: 'newer', timestamp: '2026-07-11T11:00:00' }),
      ],
      input({ weight: 90 })
    );
    expect(v).toMatchObject({ action: 'update', rowId: 'newer' });
  });

  it('a new set number inserts', () => {
    const v = decideSetSave([stored()], input({ setNo: 2 }));
    expect(v.action).toBe('insert');
  });

  it('a different day inserts', () => {
    const v = decideSetSave([stored()], input({ workoutDate: '2026-07-12' }));
    expect(v.action).toBe('insert');
  });

  it('PR: beats previous best, and only when a previous best exists', () => {
    // First-ever set is never a PR (previousBest must be > 0).
    expect(decideSetSave([], input()).action === 'insert' && decideSetSave([], input())).toMatchObject({
      is_pr: false,
    });

    const history = [stored({ date: '2026-07-01', weight: 80, reps: 5 })]; // e1RM 93.33
    const pr = decideSetSave(history, input({ setNo: 1, weight: 90, reps: 5 })); // e1RM 105
    expect(pr).toMatchObject({ action: 'insert', is_pr: true });

    const notPr = decideSetSave(history, input({ setNo: 1, weight: 70, reps: 5 }));
    expect(notPr).toMatchObject({ is_pr: false });
  });

  it('PR comparison excludes the very set being edited', () => {
    // The only history IS this set; editing it cannot PR against itself.
    const v = decideSetSave([stored({ weight: 80, reps: 5 })], input({ weight: 100, reps: 5 }));
    expect(v).toMatchObject({ action: 'update', is_pr: false });
  });
});

describe('previousBest1rm', () => {
  it('only the named exercise counts', () => {
    const rows = [
      stored({ exercise: 'Barbell Back Squat', weight: 200, reps: 5 }),
      stored({ id: 'b', set: 2, weight: 60, reps: 10 }),
    ];
    expect(previousBest1rm(rows, 'Barbell Bench Press (Strength)')).toBeCloseTo(60 * (1 + 10 / 30), 10);
  });

  it('zero-rep rows contribute zero, not a phantom best', () => {
    expect(previousBest1rm([stored({ reps: 0 })], 'Barbell Bench Press (Strength)')).toBe(0);
  });
});
