import { describe, expect, it } from 'vitest';

import type { CustomPlan } from '../custom-plan';
import { applyEditsToDay, diffDayEdits, mergeDayIntoCustomPlan } from '../plan-edits';
import { EMPTY_OVERRIDES, type DayOverrides, type PlanEntry } from '../session-plan';

const TEMPLATE: PlanEntry[] = [
  ['Lat Pulldown', 5, '8-12'],
  ['Barbell Row', 4, '5-8'],
  ['Face Pull', 3, '12-20'],
];

const o = (partial: Partial<DayOverrides>): DayOverrides => ({ ...EMPTY_OVERRIDES, ...partial });

describe('diffDayEdits', () => {
  it('an untouched day is clean', () => {
    const d = diffDayEdits(TEMPLATE, {}, EMPTY_OVERRIDES);
    expect(d.dirty).toBe(false);
    expect(d.substitutions).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.setChanges).toEqual([]);
    expect(d.supersetChanged).toBe(false);
  });

  it('SKIP and REORDER are today’s whim, never template changes', () => {
    const d = diffDayEdits(
      TEMPLATE,
      {},
      o({ skipped: ['Face Pull'], order: ['Face Pull', 'Lat Pulldown', 'Barbell Row'] })
    );
    expect(d.dirty).toBe(false);
  });

  it('reports a substitution on a template slot', () => {
    const d = diffDayEdits(TEMPLATE, {}, o({ substituted: { 'Lat Pulldown': 'Seated Cable Row' } }));
    expect(d.dirty).toBe(true);
    expect(d.substitutions).toEqual([{ from: 'Lat Pulldown', to: 'Seated Cable Row' }]);
  });

  it('substitute then REMOVE the substitute = a removal of the slot, not a swap', () => {
    const d = diffDayEdits(
      TEMPLATE,
      {},
      o({ substituted: { 'Lat Pulldown': 'Seated Cable Row' }, removed: ['Seated Cable Row'] })
    );
    expect(d.substitutions).toEqual([]);
    expect(d.removed).toEqual(['Lat Pulldown']);
    expect(d.dirty).toBe(true);
  });

  it('net-zero setDelta is clean; a real delta reports clamped from → to', () => {
    expect(diffDayEdits(TEMPLATE, {}, o({ setDelta: { 'Lat Pulldown': 0 } })).dirty).toBe(false);
    const d = diffDayEdits(TEMPLATE, {}, o({ setDelta: { 'Lat Pulldown': -2, 'Face Pull': 99 } }));
    expect(d.setChanges).toEqual([
      { exercise: 'Lat Pulldown', from: 5, to: 3 },
      { exercise: 'Face Pull', from: 3, to: 8 },
    ]);
  });

  it('a setDelta keyed by the SUBSTITUTE applies to its slot', () => {
    const d = diffDayEdits(
      TEMPLATE,
      {},
      o({ substituted: { 'Lat Pulldown': 'Seated Cable Row' }, setDelta: { 'Seated Cable Row': -2 } })
    );
    expect(d.setChanges).toEqual([{ exercise: 'Seated Cable Row', from: 5, to: 3 }]);
  });

  it('added exercises report; one colliding with a template name does not', () => {
    const d = diffDayEdits(
      TEMPLATE,
      {},
      o({
        added: [
          { exercise: 'Hammer Curl', sets: 3, reps: '8-12' },
          { exercise: 'Face Pull', sets: 3, reps: '12-20' },
        ],
      })
    );
    expect(d.added.map((a) => a.exercise)).toEqual(['Hammer Curl']);
  });

  it('supersets: an UNTOUCHED map (undefined) is never dirty; a seeded-equal map is clean; a change is dirty', () => {
    const pairs = { 'Lat Pulldown': 'Face Pull', 'Face Pull': 'Lat Pulldown' };
    expect(diffDayEdits(TEMPLATE, pairs, EMPTY_OVERRIDES).supersetChanged).toBe(false);
    expect(diffDayEdits(TEMPLATE, pairs, o({ superset: { ...pairs } })).supersetChanged).toBe(false);
    expect(diffDayEdits(TEMPLATE, pairs, o({ superset: {} })).supersetChanged).toBe(true);
    expect(
      diffDayEdits(TEMPLATE, {}, o({ superset: { ...pairs } })).supersetChanged
    ).toBe(true);
  });
});

describe('applyEditsToDay', () => {
  it('an untouched day round-trips, keeping reasons', () => {
    const reasons = new Map([['Lat Pulldown', 'width builder']]);
    const day = applyEditsToDay(TEMPLATE, reasons, EMPTY_OVERRIDES);
    expect(day).toEqual([
      { exercise: 'Lat Pulldown', sets: 5, reps: '8-12', reason: 'width builder' },
      { exercise: 'Barbell Row', sets: 4, reps: '5-8', reason: '' },
      { exercise: 'Face Pull', sets: 3, reps: '12-20', reason: '' },
    ]);
  });

  it('rename + delta + remove + add, with the 1..8 clamp — and a swapped slot loses its reason', () => {
    const reasons = new Map([['Lat Pulldown', 'width builder']]);
    const day = applyEditsToDay(
      TEMPLATE,
      reasons,
      o({
        substituted: { 'Lat Pulldown': 'Seated Cable Row' },
        setDelta: { 'Seated Cable Row': -2, 'Barbell Row': 99 },
        removed: ['Face Pull'],
        added: [{ exercise: 'Hammer Curl', sets: 3, reps: '8-12' }],
      })
    );
    expect(day).toEqual([
      { exercise: 'Seated Cable Row', sets: 3, reps: '8-12', reason: '' },
      { exercise: 'Barbell Row', sets: 8, reps: '5-8', reason: '' },
      { exercise: 'Hammer Curl', sets: 3, reps: '8-12', reason: '' },
    ]);
  });

  it('emits supersetWith only when both partners survive', () => {
    const pairs = {
      'Lat Pulldown': 'Face Pull',
      'Face Pull': 'Lat Pulldown',
      'Barbell Row': 'Gone Exercise',
      'Gone Exercise': 'Barbell Row',
    };
    const day = applyEditsToDay(TEMPLATE, null, EMPTY_OVERRIDES, pairs);
    expect(day.find((e) => e.exercise === 'Lat Pulldown')?.supersetWith).toBe('Face Pull');
    expect(day.find((e) => e.exercise === 'Face Pull')?.supersetWith).toBe('Lat Pulldown');
    expect(day.find((e) => e.exercise === 'Barbell Row')?.supersetWith).toBeUndefined();
  });

  it('SKIP does not shrink the saved day', () => {
    const day = applyEditsToDay(TEMPLATE, null, o({ skipped: ['Lat Pulldown'] }));
    expect(day.find((e) => e.exercise === 'Lat Pulldown')?.sets).toBe(5);
  });
});

describe('mergeDayIntoCustomPlan', () => {
  const DAY = {
    day: 'Pull 1 - Width',
    goal: '',
    exercises: [{ exercise: 'Lat Pulldown', sets: 5, reps: '8-12', reason: '' }],
  };

  it('no plan yet → a fresh My Plan holding just this day', () => {
    expect(mergeDayIntoCustomPlan(null, DAY)).toEqual({ plan_name: 'My Plan', days: [DAY] });
  });

  it('replaces the same-named day in place', () => {
    const plan: CustomPlan = {
      plan_name: 'Split',
      days: [{ ...DAY, exercises: [] }, { day: 'Legs', goal: '', exercises: [] }],
    };
    const merged = mergeDayIntoCustomPlan(plan, DAY);
    expect(merged.days).toHaveLength(2);
    expect(merged.days[0]).toEqual(DAY);
    expect(merged.plan_name).toBe('Split');
  });

  it('appends a day the plan does not have', () => {
    const plan: CustomPlan = { plan_name: 'Split', days: [{ day: 'Legs', goal: '', exercises: [] }] };
    const merged = mergeDayIntoCustomPlan(plan, DAY);
    expect(merged.days.map((d) => d.day)).toEqual(['Legs', 'Pull 1 - Width']);
  });
});
