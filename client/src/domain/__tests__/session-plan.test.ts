import { describe, expect, it } from 'vitest';

import {
  adhocNameError,
  applyOrder,
  applySubstitution,
  buildEffectivePlan,
  canAddSet,
  canRemoveSet,
  clearSubstitution,
  dayProgress,
  planTotals,
  removeAction,
  substitutionKey,
  EMPTY_OVERRIDES,
  MAX_SETS,
  type DayOverrides,
  type LoggedFacts,
  type PlanEntry,
} from '../session-plan';

const PLAN: PlanEntry[] = [
  ['Barbell Bench Press', 4, '5-8'],
  ['Incline Dumbbell Bench Press', 3, '8-12'],
  ['Cable Triceps Pushdown', 3, '12-20'],
];

/** A logged() built from a plain map — nothing logged unless stated. */
const loggedFrom = (m: Record<string, LoggedFacts>) => (exercise: string): LoggedFacts =>
  m[exercise] ?? { validCount: 0, maxSetNo: 0 };

const NOTHING = loggedFrom({});

const overrides = (o: Partial<DayOverrides>): DayOverrides => ({ ...EMPTY_OVERRIDES, ...o });

describe('buildEffectivePlan', () => {
  it('with no overrides it IS the plan', () => {
    const e = buildEffectivePlan(PLAN, EMPTY_OVERRIDES, NOTHING);
    expect(e.map((x) => x.exercise)).toEqual(PLAN.map((p) => p[0]));
    expect(e.map((x) => x.sets)).toEqual([4, 3, 3]);
    expect(e.every((x) => x.target === x.sets)).toBe(true);
    expect(e.every((x) => !x.skipped && !x.added)).toBe(true);
  });

  it('removed exercises disappear entirely', () => {
    const e = buildEffectivePlan(PLAN, overrides({ removed: ['Cable Triceps Pushdown'] }), NOTHING);
    expect(e.map((x) => x.exercise)).toEqual(['Barbell Bench Press', 'Incline Dumbbell Bench Press']);
  });

  it('added exercises render after the plan and are flagged', () => {
    const e = buildEffectivePlan(
      PLAN,
      overrides({ added: [{ exercise: 'Face Pull', sets: 3, reps: '12-20' }] }),
      NOTHING
    );
    expect(e[e.length - 1]).toMatchObject({ exercise: 'Face Pull', sets: 3, added: true });
  });

  it('AN EXERCISE APPEARS ONCE, even if the base plan lists it twice', () => {
    // A substitution onto something already in the day produced a duplicate:
    // two cards with the SAME React key, both showing the same logged rows, and
    // planTotals counting its target and its sets twice — so the progress bar
    // and `complete` were both wrong.
    const dupe: PlanEntry[] = [
      ['Barbell Bench Press', 4, '5-8'],
      ['Barbell Bench Press', 3, '8-12'],
    ];
    const e = buildEffectivePlan(dupe, EMPTY_OVERRIDES, NOTHING);
    expect(e).toHaveLength(1);
    expect(e[0].sets).toBe(4); // the FIRST wins; the duplicate is dropped

    const logged = loggedFrom({ 'Barbell Bench Press': { validCount: 4, maxSetNo: 4 } });
    const t = planTotals(buildEffectivePlan(dupe, EMPTY_OVERRIDES, logged), logged);
    expect(t.target).toBe(4); // not 7
    expect(t.done).toBe(4); // not 8
  });

  it('an added exercise already in the plan does not render twice', () => {
    const e = buildEffectivePlan(
      PLAN,
      overrides({ added: [{ exercise: 'Barbell Bench Press', sets: 3, reps: '8-12' }] }),
      NOTHING
    );
    expect(e.filter((x) => x.exercise === 'Barbell Bench Press')).toHaveLength(1);
  });

  it('SKIP keeps the logged sets and forgives the rest', () => {
    // 2 of 4 bench sets done, then skipped: target drops to 2, not 0 and not 4.
    const logged = loggedFrom({ 'Barbell Bench Press': { validCount: 2, maxSetNo: 2 } });
    const e = buildEffectivePlan(PLAN, overrides({ skipped: ['Barbell Bench Press'] }), logged);
    const bench = e[0];
    expect(bench.skipped).toBe(true);
    expect(bench.target).toBe(2);
    expect(bench.sets).toBe(4); // still renders its rows
  });

  it('skipping an untouched exercise owes nothing', () => {
    const e = buildEffectivePlan(PLAN, overrides({ skipped: ['Barbell Bench Press'] }), NOTHING);
    expect(e[0].target).toBe(0);
  });

  it('setDelta adds and removes slots', () => {
    const plus = buildEffectivePlan(PLAN, overrides({ setDelta: { 'Barbell Bench Press': 2 } }), NOTHING);
    expect(plus[0].sets).toBe(6);
    const minus = buildEffectivePlan(PLAN, overrides({ setDelta: { 'Barbell Bench Press': -2 } }), NOTHING);
    expect(minus[0].sets).toBe(2);
  });

  it('the set count clamps to [1, 8]', () => {
    const huge = buildEffectivePlan(PLAN, overrides({ setDelta: { 'Barbell Bench Press': 99 } }), NOTHING);
    expect(huge[0].sets).toBe(MAX_SETS);
    const tiny = buildEffectivePlan(PLAN, overrides({ setDelta: { 'Barbell Bench Press': -99 } }), NOTHING);
    expect(tiny[0].sets).toBe(1);
  });

  it('THE CLAMP THAT MATTERS: − SET can never orphan a logged row', () => {
    // Athlete logged set 3; removing slots must still render 3 rows.
    const logged = loggedFrom({ 'Barbell Bench Press': { validCount: 3, maxSetNo: 3 } });
    const e = buildEffectivePlan(PLAN, overrides({ setDelta: { 'Barbell Bench Press': -99 } }), logged);
    expect(e[0].sets).toBe(3);
  });
});

describe('planTotals', () => {
  it('counts done against target and finds the cursor', () => {
    const logged = loggedFrom({
      'Barbell Bench Press': { validCount: 4, maxSetNo: 4 },
      'Incline Dumbbell Bench Press': { validCount: 1, maxSetNo: 1 },
    });
    const t = planTotals(buildEffectivePlan(PLAN, EMPTY_OVERRIDES, logged), logged);
    expect(t.done).toBe(5);
    expect(t.target).toBe(10);
    expect(t.complete).toBe(false);
    expect(t.nextExercise).toBe('Incline Dumbbell Bench Press');
  });

  it('done can never exceed target — extra sets EXPAND the day, never overflow the bar', () => {
    // 9 valid sets logged against a 4-set plan entry (the athlete kept going,
    // or the plan shrank under them). The clamp renders every logged row, so
    // the day grows to 8 slots (the cap) rather than showing 9/4 — a bar past
    // 100% would be a lie in the other direction.
    const logged = loggedFrom({ 'Barbell Bench Press': { validCount: 9, maxSetNo: 8 } });
    const t = planTotals(buildEffectivePlan([PLAN[0]], EMPTY_OVERRIDES, logged), logged);
    expect(t.target).toBe(8);
    expect(t.done).toBe(8);
    expect(t.done).toBeLessThanOrEqual(t.target);
    expect(t.complete).toBe(true);
  });

  it('SKIPPING THE REST COMPLETES THE DAY HONESTLY', () => {
    // The whole point: 2/4 bench done, everything else skipped untouched →
    // the day reads 2/2 complete, and the +20 XP banked is consistent with it.
    const logged = loggedFrom({ 'Barbell Bench Press': { validCount: 2, maxSetNo: 2 } });
    const o = overrides({
      skipped: ['Barbell Bench Press', 'Incline Dumbbell Bench Press', 'Cable Triceps Pushdown'],
    });
    const t = planTotals(buildEffectivePlan(PLAN, o, logged), logged);
    expect(t.done).toBe(2);
    expect(t.target).toBe(2);
    expect(t.complete).toBe(true);
    expect(t.nextExercise).toBeNull();
  });

  it('an all-removed day is 0/0 and NOT complete (nothing was done)', () => {
    const o = overrides({ removed: PLAN.map((p) => p[0]) });
    const t = planTotals(buildEffectivePlan(PLAN, o, NOTHING), NOTHING);
    expect(t).toMatchObject({ done: 0, target: 0, complete: false, nextExercise: null });
  });

  it('the cursor skips over skipped exercises', () => {
    const t = planTotals(
      buildEffectivePlan(PLAN, overrides({ skipped: ['Barbell Bench Press'] }), NOTHING),
      NOTHING
    );
    expect(t.nextExercise).toBe('Incline Dumbbell Bench Press');
  });
});

describe('removeAction — the guard that keeps the summary honest', () => {
  it('nothing logged → a real remove', () => {
    expect(removeAction({ validCount: 0, maxSetNo: 0 })).toBe('remove');
  });

  it('SETS ALREADY LOGGED → degrades to skip', () => {
    // Removing it would drop those sets from `done` while their XP stays
    // banked — the day bar would contradict the XP counter beside it.
    expect(removeAction({ validCount: 1, maxSetNo: 1 })).toBe('skip');
  });

  it('a rendered-but-invalid row (typed, never logged) is still removable', () => {
    expect(removeAction({ validCount: 0, maxSetNo: 3 })).toBe('remove');
  });
});

describe('canAddSet / canRemoveSet', () => {
  it('cannot exceed 8 slots', () => {
    expect(canAddSet(7)).toBe(true);
    expect(canAddSet(8)).toBe(false);
  });

  it('cannot go below 1 slot', () => {
    expect(canRemoveSet(2, { validCount: 0, maxSetNo: 0 })).toBe(true);
    expect(canRemoveSet(1, { validCount: 0, maxSetNo: 0 })).toBe(false);
  });

  it('cannot remove a slot that holds a logged row', () => {
    expect(canRemoveSet(3, { validCount: 3, maxSetNo: 3 })).toBe(false);
    expect(canRemoveSet(4, { validCount: 3, maxSetNo: 3 })).toBe(true);
  });
});

describe('the ad-hoc name is a WORKOUT name (workout_log.workout)', () => {
  it('a saved routine can reuse a name that is not a plan day', () => {
    // Routines are named independently of the plan, so this is the common case.
    expect(adhocNameError('Beach Day', ['Push 1 - Strength', 'Legs'])).toBeNull();
  });
});

describe('adhocNameError', () => {
  const DAYS = ['Push 1 - Strength', 'Legs'];

  it('accepts a fresh name', () => {
    expect(adhocNameError('Beach Day', DAYS)).toBeNull();
  });

  it('rejects too short and too long', () => {
    expect(adhocNameError(' A ', DAYS)).toMatch(/2\+/);
    expect(adhocNameError('x'.repeat(41), DAYS)).toMatch(/40/);
  });

  it('REJECTS A DAY-CHIP COLLISION — workout is the grouping key in the log', () => {
    expect(adhocNameError('legs', DAYS)).toMatch(/already a day/);
    expect(adhocNameError('  Push 1 - Strength ', DAYS)).toMatch(/already a day/);
  });
});

describe('SUBSTITUTIONS — the swap is part of the plan, not a display trick', () => {
  it('renames the slot inside buildEffectivePlan', () => {
    const o = overrides({ substituted: { 'Barbell Bench Press': 'Machine Chest Press' } });
    const e = buildEffectivePlan(PLAN, o, NOTHING);
    expect(e.map((x) => x.exercise)).toEqual([
      'Machine Chest Press',
      'Incline Dumbbell Bench Press',
      'Cable Triceps Pushdown',
    ]);
    expect(e[0].sets).toBe(4); // the slot keeps its set count
  });

  it('sets logged under the SUBSTITUTE fill the slot', () => {
    const o = overrides({ substituted: { 'Barbell Bench Press': 'Machine Chest Press' } });
    const logged = loggedFrom({ 'Machine Chest Press': { validCount: 4, maxSetNo: 4 } });
    const t = planTotals(buildEffectivePlan(PLAN, o, logged), logged);
    expect(t.done).toBe(4);
    expect(t.nextExercise).toBe('Incline Dumbbell Bench Press');
  });

  it('THE PARTIAL-DAY BUG: swap a 5-set slot, do 3 sets of the substitute at −2 → complete', () => {
    // Replacing 5×lat pulldown with 3×seated row must not read "5 sets missed".
    const plan: PlanEntry[] = [['Lat Pulldown', 5, '8-12']];
    const o = overrides({
      substituted: { 'Lat Pulldown': 'Seated Cable Row' },
      setDelta: { 'Seated Cable Row': -2 },
    });
    const logged = loggedFrom({ 'Seated Cable Row': { validCount: 3, maxSetNo: 3 } });
    const t = planTotals(buildEffectivePlan(plan, o, logged), logged);
    expect(t.target).toBe(3);
    expect(t.done).toBe(3);
    expect(t.complete).toBe(true);
  });

  it('setDelta / skip keyed by the DISPLAYED name apply to the swapped slot', () => {
    const o = overrides({
      substituted: { 'Barbell Bench Press': 'Machine Chest Press' },
      skipped: ['Machine Chest Press'],
    });
    const e = buildEffectivePlan(PLAN, o, NOTHING);
    expect(e[0].skipped).toBe(true);
    expect(e[0].target).toBe(0);
  });

  it('substituting onto another plan exercise dedupes instead of doubling', () => {
    const o = overrides({ substituted: { 'Barbell Bench Press': 'Cable Triceps Pushdown' } });
    const logged = loggedFrom({ 'Cable Triceps Pushdown': { validCount: 3, maxSetNo: 3 } });
    const t = planTotals(buildEffectivePlan(PLAN, o, logged), logged);
    const e = buildEffectivePlan(PLAN, o, logged);
    expect(e.filter((x) => x.exercise === 'Cable Triceps Pushdown')).toHaveLength(1);
    expect(t.done).toBe(3); // counted once, not twice
  });

  it('a removed DISPLAYED name removes the swapped slot', () => {
    const o = overrides({
      substituted: { 'Barbell Bench Press': 'Machine Chest Press' },
      removed: ['Machine Chest Press'],
    });
    const e = buildEffectivePlan(PLAN, o, NOTHING);
    expect(e.map((x) => x.exercise)).not.toContain('Machine Chest Press');
    expect(e.map((x) => x.exercise)).not.toContain('Barbell Bench Press');
  });
});

describe('applySubstitution / clearSubstitution', () => {
  it('records the swap keyed by the ORIGINAL slot', () => {
    const d = applySubstitution(EMPTY_OVERRIDES, 'Lat Pulldown', 'Seated Cable Row');
    expect(d.substituted).toEqual({ 'Lat Pulldown': 'Seated Cable Row' });
  });

  it('chained swaps collapse to ONE key (orig→A then A→B stores orig→B)', () => {
    let d = applySubstitution(EMPTY_OVERRIDES, 'Lat Pulldown', 'Seated Cable Row');
    d = applySubstitution(d, 'Seated Cable Row', 'T-Bar Row');
    expect(d.substituted).toEqual({ 'Lat Pulldown': 'T-Bar Row' });
  });

  it('swapping back to the original slot IS the reset', () => {
    let d = applySubstitution(EMPTY_OVERRIDES, 'Lat Pulldown', 'Seated Cable Row');
    d = applySubstitution(d, 'Seated Cable Row', 'Lat Pulldown');
    expect(d.substituted).toEqual({});
  });

  it('MIGRATES the athlete’s intent: setDelta, skip, superset, order follow the new name', () => {
    const before = overrides({
      setDelta: { 'Lat Pulldown': -2 },
      skipped: ['Lat Pulldown'],
      superset: { 'Lat Pulldown': 'Face Pull', 'Face Pull': 'Lat Pulldown' },
      order: ['Face Pull', 'Lat Pulldown'],
    });
    const d = applySubstitution(before, 'Lat Pulldown', 'Seated Cable Row');
    expect(d.setDelta).toEqual({ 'Seated Cable Row': -2 });
    expect(d.skipped).toEqual(['Seated Cable Row']);
    expect(d.superset).toEqual({ 'Seated Cable Row': 'Face Pull', 'Face Pull': 'Seated Cable Row' });
    expect(d.order).toEqual(['Face Pull', 'Seated Cable Row']);
  });

  it('lifts a removed tombstone on the substitute — you just asked for it', () => {
    const before = overrides({ removed: ['Seated Cable Row'] });
    const d = applySubstitution(before, 'Lat Pulldown', 'Seated Cable Row');
    expect(d.removed).toEqual([]);
  });

  it('clearSubstitution restores the slot and migrates keys back', () => {
    let d = applySubstitution(EMPTY_OVERRIDES, 'Lat Pulldown', 'Seated Cable Row');
    d = { ...d, setDelta: { 'Seated Cable Row': 1 } };
    d = clearSubstitution(d, 'Seated Cable Row');
    expect(d.substituted).toEqual({});
    expect(d.setDelta).toEqual({ 'Lat Pulldown': 1 });
  });

  it('clearSubstitution on an unswapped name is a no-op', () => {
    expect(clearSubstitution(EMPTY_OVERRIDES, 'Lat Pulldown')).toBe(EMPTY_OVERRIDES);
  });

  it('substitutionKey maps a displayed name back to its slot', () => {
    const subs = { 'Lat Pulldown': 'Seated Cable Row' };
    expect(substitutionKey(subs, 'Seated Cable Row')).toBe('Lat Pulldown');
    expect(substitutionKey(subs, 'Face Pull')).toBe('Face Pull');
  });
});

describe('dayProgress — the hub and the workout page share one pipeline', () => {
  it('agrees with planTotals', () => {
    const o = overrides({
      substituted: { 'Barbell Bench Press': 'Machine Chest Press' },
      skipped: ['Cable Triceps Pushdown'],
    });
    const logged = loggedFrom({ 'Machine Chest Press': { validCount: 2, maxSetNo: 2 } });
    const t = planTotals(buildEffectivePlan(PLAN, o, logged), logged);
    expect(dayProgress(PLAN, o, logged)).toEqual({ done: t.done, target: t.target });
  });

  it('null overrides mean the raw plan', () => {
    expect(dayProgress(PLAN, null, NOTHING)).toEqual({ done: 0, target: 10 });
  });
});

describe('applyOrder', () => {
  const items = [
    { exercise: 'A', sets: 3 },
    { exercise: 'B', sets: 3 },
    { exercise: 'C', sets: 3 },
  ];

  it('returns a copy unchanged when no order is given', () => {
    expect(applyOrder(items, undefined).map((e) => e.exercise)).toEqual(['A', 'B', 'C']);
    expect(applyOrder(items, []).map((e) => e.exercise)).toEqual(['A', 'B', 'C']);
  });

  it('reorders by the given names', () => {
    expect(applyOrder(items, ['C', 'A', 'B']).map((e) => e.exercise)).toEqual(['C', 'A', 'B']);
  });

  it('appends unranked entries after ranked ones, keeping their relative order', () => {
    // D and E are not in the order list (added after the reorder).
    const more = [...items, { exercise: 'D', sets: 3 }, { exercise: 'E', sets: 3 }];
    expect(applyOrder(more, ['C', 'A']).map((e) => e.exercise)).toEqual(['C', 'A', 'B', 'D', 'E']);
  });

  it('never drops an entry when the order names something absent', () => {
    // 'Z' was removed since the order was saved; the rest still all appear.
    const out = applyOrder(items, ['Z', 'B', 'A', 'C']);
    expect(out.map((e) => e.exercise).sort()).toEqual(['A', 'B', 'C']);
    expect(out.map((e) => e.exercise)).toEqual(['B', 'A', 'C']);
  });
});
