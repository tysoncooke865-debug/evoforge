import { describe, expect, it } from 'vitest';

import { completedSessions, trainedOn } from '../session-stats';
import { weeklyContract } from '../scheduled-streak';
import { periodTotals } from '../progress-aggregates';
import { computeStreak } from '../streak';

/**
 * THE CANONICAL SESSION COUNT (Tyson, 2026-08-06: "WORKOUTS 0 / 1,
 * SESSIONS 0 / 1" on a day a workout was demonstrably completed).
 *
 * The six cases the brief names, plus the three divergences that produced the
 * bug — every counter in the app must now agree with this file.
 */

const TODAY = '2026-08-06'; // Thursday
const MONDAY = '2026-08-03';

const set = (date: string, workout: string, exercise = 'Bench Press', weight = 60, reps = 8) => ({
  date,
  workout,
  exercise,
  set: 1,
  weight,
  reps,
  timestamp: `${date}T10:00:00`,
});

const cardio = (date: string, type = 'Run', minutes = 30) => ({
  date,
  type,
  minutes,
  distance_km: 5,
  timestamp: `${date}T18:00:00`,
});

describe('one completed strength workout', () => {
  it('counts as exactly one strength session, one training day', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1'), set(TODAY, 'Push 1', 'Incline Press')],
      finishes: [{ date: TODAY, workout: 'Push 1' }],
    });
    expect(s.strength).toBe(1);
    expect(s.cardio).toBe(0);
    expect(s.days).toBe(1);
    expect(s.total).toBe(1);
    expect(s.sessions[0].sets).toBe(2);
    expect(s.sessions[0].finished).toBe(true);
    expect(trainedOn(s, TODAY)).toBe(true);
  });

  it('counts WITHOUT a finish marker — history has none and it still happened', () => {
    const s = completedSessions({ workoutRows: [set(TODAY, 'Push 1')] });
    expect(s.strength).toBe(1);
    expect(s.sessions[0].finished).toBe(false);
  });

  it('counts when the athlete finished with no set the predicate accepted', () => {
    // The marker is the decision and outranks inference (week-status doctrine).
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1', 'Bench Press', 60, 0)], // reps 0 — not a counted set
      finishes: [{ date: TODAY, workout: 'Push 1' }],
    });
    expect(s.strength).toBe(1);
    expect(s.sessions[0].sets).toBe(0);
  });

  it('counts 0 kg bodyweight work — 061 says a 0 kg set is a set', () => {
    const s = completedSessions({ workoutRows: [set(TODAY, 'Calisthenics', 'Push-Up', 0, 20)] });
    expect(s.strength).toBe(1);
    expect(s.sessions[0].sets).toBe(1);
  });
});

describe('one completed cardio session', () => {
  it('counts as one cardio session and one training day', () => {
    const s = completedSessions({ workoutRows: [], cardioRows: [cardio(TODAY)] });
    expect(s.cardio).toBe(1);
    expect(s.strength).toBe(0);
    expect(s.days).toBe(1);
    expect(s.total).toBe(1);
    expect(s.sessions[0].minutes).toBe(30);
  });

  it('THE BUG: a cardio-only day is never zero sessions', () => {
    const s = completedSessions({ workoutRows: [], cardioRows: [cardio(TODAY, 'Row', 45)] });
    expect(s.days).toBeGreaterThan(0);
  });
});

describe('multiple workouts on the same day', () => {
  it('two different workouts are two sessions but ONE training day', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1'), set(TODAY, 'Arms Accessory', 'Curl')],
    });
    expect(s.strength).toBe(2);
    expect(s.days).toBe(1);
    expect(s.total).toBe(2);
  });

  it('strength AND cardio on one day: one of each, still one training day', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1')],
      cardioRows: [cardio(TODAY)],
    });
    expect(s.strength).toBe(1);
    expect(s.cardio).toBe(1);
    expect(s.total).toBe(2);
    expect(s.days).toBe(1); // NOT double-counted as two training days
  });
});

describe('a workout saved twice', () => {
  it('duplicate finish markers collapse to one session', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1')],
      finishes: [
        { date: TODAY, workout: 'Push 1' },
        { date: TODAY, workout: 'Push 1' },
      ],
    });
    expect(s.strength).toBe(1);
  });

  it('a marker with no matching log row does not add a second session', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1'), set(TODAY, 'Push 1', 'Fly')],
      finishes: [{ date: TODAY, workout: 'Push 1' }],
    });
    expect(s.strength).toBe(1);
    expect(s.sessions).toHaveLength(1);
  });
});

describe('a failed or abandoned workout', () => {
  it('opened and closed with nothing logged is NOT a session', () => {
    const s = completedSessions({ workoutRows: [], finishes: [] });
    expect(s.total).toBe(0);
    expect(s.days).toBe(0);
  });

  it('rows that fail the counted-set predicate are not a session', () => {
    const s = completedSessions({
      workoutRows: [
        set(TODAY, 'Push 1', 'Bench Press', 60, 0), // no reps
        { ...set(TODAY, 'Push 1', 'Fly'), weight: null } as never, // no weight
      ],
    });
    expect(s.total).toBe(0);
  });

  it('an abandoned workout does not poison a real one on the same day', () => {
    const s = completedSessions({
      workoutRows: [set(TODAY, 'Push 1'), set(TODAY, 'Abandoned', 'Fly', 20, 0)],
    });
    expect(s.strength).toBe(1);
    expect(s.sessions[0].name).toBe('Push 1');
  });
});

describe('reloading the app after completion', () => {
  it('is idempotent — the same persisted rows always give the same answer', () => {
    const input = {
      workoutRows: [set(TODAY, 'Push 1'), set(TODAY, 'Push 1', 'Fly')],
      cardioRows: [cardio(TODAY)],
      finishes: [{ date: TODAY, workout: 'Push 1' }],
    };
    const first = completedSessions(input);
    for (let i = 0; i < 5; i += 1) {
      const again = completedSessions(input);
      expect(again.strength).toBe(first.strength);
      expect(again.cardio).toBe(first.cardio);
      expect(again.days).toBe(first.days);
      expect(again.total).toBe(first.total);
    }
  });

  it('row ORDER never changes the answer — a refetch may return any order', () => {
    const rows = [set('2026-08-05', 'A'), set(TODAY, 'B'), set(TODAY, 'A')];
    const a = completedSessions({ workoutRows: rows });
    const b = completedSessions({ workoutRows: [...rows].reverse() });
    expect(b.total).toBe(a.total);
    expect(b.days).toBe(a.days);
    expect(b.sessions.map((s) => `${s.date}|${s.name}`)).toEqual(
      a.sessions.map((s) => `${s.date}|${s.name}`)
    );
  });

  it('windows are inclusive at both ends', () => {
    const rows = [set('2026-08-02', 'A'), set(MONDAY, 'B'), set(TODAY, 'C'), set('2026-08-07', 'D')];
    const s = completedSessions({ workoutRows: rows, fromIso: MONDAY, toIso: TODAY });
    expect(s.strength).toBe(2);
    expect(s.dates.has(MONDAY)).toBe(true);
    expect(s.dates.has(TODAY)).toBe(true);
  });
});

/**
 * THE THREE DIVERGENCES. Each of these failed before the canonical calculation
 * existed; they are the actual reported bug, pinned at the surfaces that
 * showed it.
 */
describe('every surface agrees with the canonical count', () => {
  const schedule = [
    {
      effective_from: '2026-08-01',
      // 0=Sun..6=Sat. Only WEDNESDAY is scheduled — one training day this week.
      plan: { '0': 'Rest', '1': 'Rest', '2': 'Rest', '3': 'Aesthetics', '4': 'Rest', '5': 'Rest', '6': 'Rest' },
    },
  ];

  it('THE BUG: a workout completed OFF the schedule is not zero', () => {
    // Trained Thursday; only Wednesday was scheduled. Was 0 / 1.
    const rows = [set(TODAY, 'Push 1')];
    const c = weeklyContract(schedule, rows, TODAY);
    expect(c.target).toBe(1);
    expect(c.done).toBe(1);
    expect(c.pips.find((p) => p.date === TODAY)?.state).toBe('completed');
  });

  it('the pip and the counter can never disagree', () => {
    const rows = [set(TODAY, 'Push 1'), set('2026-08-05', 'Aesthetics')];
    const c = weeklyContract(schedule, rows, TODAY);
    expect(c.done).toBe(c.pips.filter((p) => p.state === 'completed').length);
  });

  it('a completed cardio session counts toward the weekly contract', () => {
    const c = weeklyContract(schedule, [], TODAY, { cardioRows: [cardio(TODAY)] });
    expect(c.done).toBe(1);
  });

  it('a finished workout with no counted set still counts', () => {
    const c = weeklyContract(schedule, [], TODAY, {
      finishes: [{ date: TODAY, workout: 'Push 1' }],
    });
    expect(c.done).toBe(1);
  });

  it('target stays the PLAN — a bonus day never inflates the quota', () => {
    const c = weeklyContract(schedule, [set(TODAY, 'A'), set('2026-08-04', 'B')], TODAY);
    expect(c.target).toBe(1);
    expect(c.done).toBe(2); // honest: two sessions against a one-session plan
  });

  it('periodTotals.sessions counts a cardio-only day', () => {
    const t = periodTotals([], [cardio(TODAY)], MONDAY, TODAY);
    expect(t.sessions).toBe(1);
    expect(t.cardioSessions).toBe(1);
    expect(t.strengthSessions).toBe(0);
  });

  it('periodTotals and completedSessions never disagree', () => {
    const rows = [set(TODAY, 'Push 1'), set('2026-08-04', 'Pull 1')];
    const cardioRows = [cardio(TODAY), cardio('2026-08-04', 'Bike', 20)];
    const t = periodTotals(rows, cardioRows, MONDAY, TODAY);
    const s = completedSessions({ workoutRows: rows, cardioRows, fromIso: MONDAY, toIso: TODAY });
    expect(t.sessions).toBe(s.days);
    expect(t.strengthSessions).toBe(s.strength);
    expect(t.cardioSessions).toBe(s.cardio);
  });

  it('the streak counts a 0 kg bodyweight day — it used to require weight > 0', () => {
    const rows = [set(TODAY, 'Calisthenics', 'Push-Up', 0, 20)];
    expect(computeStreak(rows, TODAY).current).toBe(1);
    expect(computeStreak(rows, TODAY).trainedToday).toBe(true);
  });

  it('the streak counts a cardio-only day when cardio is supplied', () => {
    expect(computeStreak([], TODAY, { cardioRows: [cardio(TODAY)] }).current).toBe(1);
  });

  it('the streak and the canonical count agree on which days were trained', () => {
    const rows = [set(TODAY, 'A'), set('2026-08-05', 'B'), set('2026-08-04', 'C')];
    const s = completedSessions({ workoutRows: rows });
    expect(computeStreak(rows, TODAY).current).toBe(s.days);
  });
});
