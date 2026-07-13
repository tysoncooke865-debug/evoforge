import { describe, expect, it } from 'vitest';

import type { ScheduleRow } from '../scheduled-streak';
import { buildWeekBars, scheduledDayFor, todayBar, type SessionMarker } from '../week-status';

// Mon–Fri training, weekend rest. 2026-07-15 is a Wednesday (UTC).
const WEEK: ScheduleRow = {
  effective_from: '2026-01-01',
  plan: { '0': 'Rest', '1': 'Push', '2': 'Pull', '3': 'Legs', '4': 'Upper', '5': 'Lower', '6': 'Rest' },
};
const TODAY = '2026-07-15'; // Wednesday → Legs
const MONDAY = '2026-07-13';
const TUESDAY = '2026-07-14';
const THURSDAY = '2026-07-16';

const noSets = () => false;
const setsOn = (...dates: string[]) => (date: string) => dates.includes(date);

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

    it('THE BUG: finishing EARLY sticks — today stays completed with 1 set of 20', () => {
      // Before the marker, `complete` was derived (done >= target), so a
      // workout finished early snapped back to in-progress the moment the
      // summary closed. The marker is what makes the decision survive.
      const marker: SessionMarker = { id: 'sess-2', date: TODAY, workout: 'Legs' };
      const bars = buildWeekBars([WEEK], [marker], setsOn(TODAY), TODAY)!;
      expect(todayBar(bars, TODAY)!.status).toBe('completed');
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
