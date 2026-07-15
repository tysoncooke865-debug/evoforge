import { describe, expect, it } from 'vitest';

import type { ScheduleRow } from '../scheduled-streak';
import {
  buildWeekBars,
  extraBarsForToday,
  scheduledDayFor,
  sourceDayFor,
  todayBar,
  type SessionMarker,
} from '../week-status';

// Mon–Fri training, weekend rest. 2026-07-15 is a Wednesday (UTC).
const WEEK: ScheduleRow = {
  effective_from: '2026-01-01',
  plan: { '0': 'Rest', '1': 'Push', '2': 'Pull', '3': 'Legs', '4': 'Upper', '5': 'Lower', '6': 'Rest' },
};
const TODAY = '2026-07-15'; // Wednesday → Legs
const MONDAY = '2026-07-13';
const TUESDAY = '2026-07-14';
const THURSDAY = '2026-07-16';

// Progress callbacks (TRAIN_OVERHAUL): {done, target, trained}. `noSets` /
// `setsOn` mirror the old boolean world — trained days read as fully done.
const noSets = () => ({ done: 0, target: 0, trained: false });
const setsOn =
  (...dates: string[]) =>
  (date: string) =>
    dates.includes(date) ? { done: 5, target: 5, trained: true } : { done: 0, target: 5, trained: false };
/** A fixed fraction everywhere — for pinning the partial threshold. */
const progressOf = (done: number, target: number, trained = done > 0) => () => ({ done, target, trained });

describe('scheduledDayFor', () => {
  it('reads the plan in force on that date', () => {
    expect(scheduledDayFor(TODAY, [WEEK])).toBe('Legs');
    expect(scheduledDayFor('2026-07-18', [WEEK])).toBeNull(); // Saturday = Rest
  });

  it('EFFECTIVE-DATING: a reschedule governs only the days it covers', () => {
    const reschedule: ScheduleRow = { effective_from: '2026-07-15', plan: { ...WEEK.plan, '3': 'Arms' } };
    expect(scheduledDayFor(TUESDAY, [WEEK, reschedule])).toBe('Pull'); // before it
    expect(scheduledDayFor(TODAY, [WEEK, reschedule])).toBe('Arms'); // on and after
  });

  it('no schedule at all → nothing is scheduled', () => {
    expect(scheduledDayFor(TODAY, [])).toBeNull();
  });
});

describe('buildWeekBars', () => {
  it('NO SCHEDULE → null, so the caller keeps the old day chips', () => {
    expect(buildWeekBars([], [], noSets, TODAY)).toBeNull();
  });

  it('a schedule gives SEVEN bars, Monday first (positive control)', () => {
    const bars = buildWeekBars([WEEK], [], noSets, TODAY)!;
    expect(bars).toHaveLength(7);
    expect(bars[0].date).toBe(MONDAY);
    expect(bars.filter((b) => b.workout !== null).length).toBe(5);
  });

  describe('THE STATUS MATRIX', () => {
    it('today is IN PROGRESS — with or without sets', () => {
      expect(buildWeekBars([WEEK], [], noSets, TODAY)![2].status).toBe('in_progress');
      expect(buildWeekBars([WEEK], [], setsOn(TODAY), TODAY)![2].status).toBe('in_progress');
    });

    it('a future scheduled day is UPCOMING', () => {
      const bars = buildWeekBars([WEEK], [], noSets, TODAY)!;
      expect(bars.find((b) => b.date === THURSDAY)!.status).toBe('upcoming');
    });

    it('a past scheduled day with NO sets is MISSED', () => {
      const bars = buildWeekBars([WEEK], [], noSets, TODAY)!;
      expect(bars.find((b) => b.date === MONDAY)!.status).toBe('missed');
    });

    it('BACKWARDS COMPAT: a past day with sets but NO marker is COMPLETED', () => {
      // Every workout in this athlete's history predates the feature. None of
      // them may show as MISSED.
      const bars = buildWeekBars([WEEK], [], setsOn(MONDAY), TODAY)!;
      expect(bars.find((b) => b.date === MONDAY)!.status).toBe('completed');
    });

    it('a MARKER makes it COMPLETED even with no sets (they said they were done)', () => {
      const marker: SessionMarker = { id: 's1', date: MONDAY, workout: 'Push' };
      const bars = buildWeekBars([WEEK], [marker], noSets, TODAY)!;
      expect(bars.find((b) => b.date === MONDAY)!.status).toBe('completed');
    });

    it('a rest day is REST and holds no workout', () => {
      const bars = buildWeekBars([WEEK], [], noSets, TODAY)!;
      const sunday = bars[6];
      expect(sunday.status).toBe('rest');
      expect(sunday.workout).toBeNull();
    });
  });

  describe('THE PARTIAL MATRIX (TRAIN_OVERHAUL) — marker present, plan not met', () => {
    const marker: SessionMarker = { id: 'p1', date: MONDAY, workout: 'Push' };
    const monOf = (bars: ReturnType<typeof buildWeekBars>) => bars!.find((b) => b.date === MONDAY)!;

    it('marker && done < target → PARTIAL, and it is still LOCKED (it was explicitly finished)', () => {
      const mon = monOf(buildWeekBars([WEEK], [marker], progressOf(3, 20), TODAY));
      expect(mon.status).toBe('partial');
      expect(mon.locked).toBe(true);
      expect(mon.sessionId).toBe('p1');
    });

    it('marker && done === target → COMPLETED (the boundary is strict)', () => {
      expect(monOf(buildWeekBars([WEEK], [marker], progressOf(20, 20), TODAY)).status).toBe('completed');
    });

    it('marker && done > target (extra credit) → COMPLETED', () => {
      expect(monOf(buildWeekBars([WEEK], [marker], progressOf(25, 20), TODAY)).status).toBe('completed');
    });

    it('marker && target 0 (the plan knows no sets to ask for) → COMPLETED, never partial-of-nothing', () => {
      expect(monOf(buildWeekBars([WEEK], [marker], progressOf(0, 0, false), TODAY)).status).toBe('completed');
    });

    it('NO marker: derivation NEVER yields partial — an unmarked past day with some sets stays COMPLETED', () => {
      // Inventing "you stopped early" for history nobody finished-early would
      // lie about the past; the pre-marker rule is untouched.
      const mon = monOf(buildWeekBars([WEEK], [], progressOf(3, 20, true), TODAY));
      expect(mon.status).toBe('completed');
      expect(mon.locked).toBe(false);
    });

    it('a swapped-everything day (done 0 vs plan, but trained) stays COMPLETED — trained is its own signal', () => {
      const mon = monOf(buildWeekBars([WEEK], [], progressOf(0, 20, true), TODAY));
      expect(mon.status).toBe('completed');
    });

    it('the bars carry done/target for the UI fraction', () => {
      const mon = monOf(buildWeekBars([WEEK], [marker], progressOf(3, 20), TODAY));
      expect(mon.done).toBe(3);
      expect(mon.target).toBe(20);
    });
  });

  describe('LOCKING KEYS ONLY ON THE MARKER', () => {
    it('a pre-feature completed workout is NOT locked — history stays editable', () => {
      const bars = buildWeekBars([WEEK], [], setsOn(MONDAY), TODAY)!;
      const mon = bars.find((b) => b.date === MONDAY)!;
      expect(mon.status).toBe('completed');
      expect(mon.locked).toBe(false); // THE distinction
      expect(mon.sessionId).toBeNull();
    });

    it('an explicitly finished workout IS locked, and carries the id REOPEN deletes', () => {
      const marker: SessionMarker = { id: 'sess-1', date: TODAY, workout: 'Legs' };
      const bars = buildWeekBars([WEEK], [marker], setsOn(TODAY), TODAY)!;
      const t = todayBar(bars, TODAY)!;
      expect(t.status).toBe('completed');
      expect(t.locked).toBe(true);
      expect(t.sessionId).toBe('sess-1');
    });

    it('THE BUG: finishing EARLY sticks — 1 set of 20 stays decided (PARTIAL now), never in-progress', () => {
      // Before the marker, `complete` was derived (done >= target), so a
      // workout finished early snapped back to in-progress the moment the
      // summary closed. The marker is what makes the decision survive —
      // TRAIN_OVERHAUL names that early finish honestly: PARTIAL.
      const marker: SessionMarker = { id: 'sess-2', date: TODAY, workout: 'Legs' };
      const bars = buildWeekBars([WEEK], [marker], progressOf(1, 20), TODAY)!;
      expect(todayBar(bars, TODAY)!.status).toBe('partial');
      expect(todayBar(bars, TODAY)!.locked).toBe(true);
    });

    it('a marker for a DIFFERENT workout that day does not finish this one', () => {
      const marker: SessionMarker = { id: 'x', date: TODAY, workout: 'Push' }; // not Legs
      const bars = buildWeekBars([WEEK], [marker], noSets, TODAY)!;
      expect(todayBar(bars, TODAY)!.status).toBe('in_progress');
      expect(todayBar(bars, TODAY)!.locked).toBe(false);
    });
  });

  it('a reschedule mid-week changes only the days it covers', () => {
    const reschedule: ScheduleRow = { effective_from: TODAY, plan: { ...WEEK.plan, '3': 'Arms' } };
    const bars = buildWeekBars([WEEK, reschedule], [], noSets, TODAY)!;
    expect(bars.find((b) => b.date === MONDAY)!.workout).toBe('Push');
    expect(todayBar(bars, TODAY)!.workout).toBe('Arms');
  });
});

describe('sourceDayFor — switching plan source renames today and the FUTURE, never the past', () => {
  // WEEK schedules Push/Pull/Legs/Upper/Lower Mon-Fri. The chosen source is a
  // 3-day plan with its own names, none of which the schedule uses.
  const DAYS = ['Alpha', 'Beta', 'Gamma'];
  const hasNone = () => false;
  const hasAll = () => true;

  it('a rest day stays a rest day — slots are the schedule, names follow the source', () => {
    expect(sourceDayFor('2026-07-19', [WEEK], DAYS, hasNone, TODAY)).toBeNull(); // Sunday
  });

  it('HISTORY IS HISTORY: a past date keeps its scheduled name', () => {
    expect(sourceDayFor(MONDAY, [WEEK], DAYS, hasNone, TODAY)).toBe('Push');
    expect(sourceDayFor(TUESDAY, [WEEK], DAYS, hasNone, TODAY)).toBe('Pull');
  });

  it('a name the source OWNS stays put', () => {
    expect(sourceDayFor(TODAY, [WEEK], DAYS, hasAll, TODAY)).toBe('Legs');
  });

  it('today and upcoming remap positionally onto the source days', () => {
    // Mon Tue Wed Thu Fri are training slots 0..4 → Alpha Beta Gamma Alpha Beta
    expect(sourceDayFor(TODAY, [WEEK], DAYS, hasNone, TODAY)).toBe('Gamma'); // Wed = slot 2
    expect(sourceDayFor(THURSDAY, [WEEK], DAYS, hasNone, TODAY)).toBe('Alpha'); // slot 3 cycles
    expect(sourceDayFor('2026-07-17', [WEEK], DAYS, hasNone, TODAY)).toBe('Beta'); // Fri = slot 4
  });

  it('an empty source (nothing saved yet) changes nothing', () => {
    expect(sourceDayFor(TODAY, [WEEK], [], hasNone, TODAY)).toBe('Legs');
  });

  it('threads through buildWeekBars as the dayFor override', () => {
    const dayFor = (date: string) => sourceDayFor(date, [WEEK], DAYS, hasNone, TODAY);
    const bars = buildWeekBars([WEEK], [], noSets, TODAY, dayFor)!;
    expect(todayBar(bars, TODAY)!.workout).toBe('Gamma'); // remapped
    expect(bars.find((b) => b.date === MONDAY)!.workout).toBe('Push'); // history
    expect(bars.find((b) => b.date === THURSDAY)!.workout).toBe('Alpha'); // upcoming
  });
});

describe('extraBarsForToday — an off-schedule workout must have a HOME', () => {
  // Before this, finishing an ad-hoc workout left it green NOWHERE and
  // reachable NOWHERE: the week only knows about scheduled days.
  const set = (workout: string, date = TODAY, weight = 60, reps = 8) => ({
    date,
    workout,
    weight,
    reps,
  });

  it('nothing off-schedule → no extra bars', () => {
    expect(extraBarsForToday([set('Legs')], [], null, 'Legs', TODAY)).toEqual([]);
  });

  it('a workout TRAINED today that is not the scheduled day gets a bar', () => {
    const bars = extraBarsForToday([set('Beach Day')], [], null, 'Legs', TODAY);
    expect(bars.map((b) => b.workout)).toEqual(['Beach Day']);
    expect(bars[0].status).toBe('in_progress');
    expect(bars[0].date).toBe(TODAY);
  });

  it('a workout FINISHED today off-schedule gets a bar, and it is COMPLETED + locked', () => {
    const marker: SessionMarker = { id: 'm1', date: TODAY, workout: 'Beach Day' };
    const bars = extraBarsForToday([], [marker], null, 'Legs', TODAY);
    expect(bars[0]).toMatchObject({ workout: 'Beach Day', status: 'completed', locked: true, sessionId: 'm1' });
  });

  it('a FINISHED extra that fell short of its plan is PARTIAL, same rule as the week', () => {
    const marker: SessionMarker = { id: 'm2', date: TODAY, workout: 'Beach Day' };
    const bars = extraBarsForToday([], [marker], null, 'Legs', TODAY, progressOf(2, 9));
    expect(bars[0]).toMatchObject({ workout: 'Beach Day', status: 'partial', locked: true, done: 2, target: 9 });
  });

  it('the ad-hoc workout IN PROGRESS gets a bar before its first set lands', () => {
    const bars = extraBarsForToday([], [], 'Beach Day', 'Legs', TODAY);
    expect(bars.map((b) => b.workout)).toEqual(['Beach Day']);
  });

  it('an INVALID set does not conjure a bar', () => {
    expect(extraBarsForToday([set('Beach Day', TODAY, 0, 8)], [], null, 'Legs', TODAY)).toEqual([]);
  });

  it('YESTERDAY is history — the extra bars are only for today', () => {
    expect(extraBarsForToday([set('Beach Day', MONDAY)], [], null, 'Legs', TODAY)).toEqual([]);
  });

  it('the scheduled day never doubles up', () => {
    const marker: SessionMarker = { id: 'm', date: TODAY, workout: 'Legs' };
    expect(extraBarsForToday([set('Legs')], [marker], 'Legs', 'Legs', TODAY)).toEqual([]);
  });

  it('two off-schedule workouts each get their own bar, deduped', () => {
    const bars = extraBarsForToday(
      [set('Beach Day'), set('Beach Day'), set('Arms Blast')],
      [],
      null,
      'Legs',
      TODAY
    );
    expect(bars.map((b) => b.workout).sort()).toEqual(['Arms Blast', 'Beach Day']);
  });
});
