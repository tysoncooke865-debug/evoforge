import { describe, expect, it } from 'vitest';

import {
  canTrainEarly,
  claimKey,
  indexClaims,
  type PlanClaim,
} from '../plan-claims';
import type { ScheduleRow } from '../scheduled-streak';
import { buildWeekBars, type SessionMarker } from '../week-status';

/**
 * §2 / §24 — TRAINING EARLY, AND WHAT IT MUST NOT BREAK.
 *
 * §29's standard for this feature is explicit: "do not consider early
 * training implemented if it merely changes a date visually while creating
 * duplicate plan sessions behind the scenes." So the assertions that matter
 * most here are the ones about what does NOT happen — no duplicate, no second
 * session on the original day, no lock nobody agreed to, and no collision of
 * two workouts under one (date, workout) key.
 */

const TODAY = '2026-08-10'; // a Monday
const claim = (planned: string, workout: string, completed = TODAY): PlanClaim => ({
  planned_date: planned,
  workout,
  completed_date: completed,
});

describe('the claim index', () => {
  it('is empty and cheap when nothing has been moved', () => {
    expect(indexClaims(undefined).size).toBe(0);
    expect(indexClaims([]).isClaimed('2026-08-12', 'Legs')).toBe(false);
  });

  it('answers for exactly the session that was claimed', () => {
    const ix = indexClaims([claim('2026-08-12', 'Legs')]);
    expect(ix.isClaimed('2026-08-12', 'Legs')).toBe(true);
    // Not a different day...
    expect(ix.isClaimed('2026-08-13', 'Legs')).toBe(false);
    // ...and not a different workout on the same day.
    expect(ix.isClaimed('2026-08-12', 'Push')).toBe(false);
    expect(ix.for('2026-08-12', 'Legs')?.completed_date).toBe(TODAY);
  });

  it('keys on the pair, which IS the planned session`s identity', () => {
    expect(claimKey('2026-08-12', 'Legs')).toBe('2026-08-12|Legs');
  });
});

describe('canTrainEarly', () => {
  const base = {
    todayIso: TODAY,
    claims: indexClaims([]),
    namesInPlayToday: [] as string[],
  };

  it('allows tomorrow, and two days out', () => {
    expect(canTrainEarly({ ...base, plannedDate: '2026-08-11', workout: 'Pull' }).ok).toBe(true);
    expect(canTrainEarly({ ...base, plannedDate: '2026-08-12', workout: 'Legs' }).ok).toBe(true);
  });

  it('refuses today and the past — those are not "early"', () => {
    expect(canTrainEarly({ ...base, plannedDate: TODAY, workout: 'Push' })).toEqual({
      ok: false,
      reason: 'not-future',
    });
    expect(canTrainEarly({ ...base, plannedDate: '2026-08-09', workout: 'Push' })).toEqual({
      ok: false,
      reason: 'not-future',
    });
  });

  it('refuses a session already trained early — no duplicates', () => {
    const claims = indexClaims([claim('2026-08-12', 'Legs')]);
    expect(canTrainEarly({ ...base, claims, plannedDate: '2026-08-12', workout: 'Legs' })).toEqual({
      ok: false,
      reason: 'already-claimed',
    });
  });

  it('refuses a name already in play today — two sessions may not share a key', () => {
    // Sets are keyed (date, workout). Pulling Wednesday's "Legs" onto a day
    // that already has a "Legs" would file both under one key and fuse them.
    expect(
      canTrainEarly({
        ...base,
        namesInPlayToday: ['Legs', 'Cardio'],
        plannedDate: '2026-08-12',
        workout: 'Legs',
      })
    ).toEqual({ ok: false, reason: 'name-in-play-today' });
  });

  it('but a DIFFERENT workout today is fine — multiple sessions a day are supported', () => {
    expect(
      canTrainEarly({
        ...base,
        namesInPlayToday: ['Push'],
        plannedDate: '2026-08-12',
        workout: 'Legs',
      }).ok
    ).toBe(true);
  });
});

describe('the week rail after an early session', () => {
  const schedule: ScheduleRow[] = [
    {
      effective_from: '2026-01-01',
      plan: { 1: 'Push', 2: 'Pull', 3: 'Legs', 4: '', 5: 'Push', 6: '', 0: '' },
    } as unknown as ScheduleRow,
  ];
  const noProgress = () => ({ done: 0, target: 6, trained: false });
  const bars = (claims: PlanClaim[], sessions: SessionMarker[] = []) =>
    buildWeekBars(schedule, sessions, noProgress, TODAY, undefined, (d, w) =>
      indexClaims(claims).isClaimed(d, w)
    );

  it('leaves the week alone when nothing was moved', () => {
    const wed = bars([])?.find((b) => b.date === '2026-08-12');
    expect(wed?.workout).toBe('Legs');
    expect(wed?.status).toBe('upcoming');
  });

  it('reads COMPLETED on the day the session was scheduled for', () => {
    const wed = bars([claim('2026-08-12', 'Legs')])?.find((b) => b.date === '2026-08-12');
    expect(wed?.status).toBe('completed');
  });

  it('does NOT lock it — locking keys only on the finish marker', () => {
    // The marker lives on the day it was actually trained. A lock here would
    // lock a day nobody agreed to lock, and REOPEN would find nothing to
    // delete on it.
    const wed = bars([claim('2026-08-12', 'Legs')])?.find((b) => b.date === '2026-08-12');
    expect(wed?.locked).toBe(false);
    expect(wed?.sessionId).toBeNull();
  });

  it('does not duplicate the session anywhere else in the week', () => {
    const week = bars([claim('2026-08-12', 'Legs')]) ?? [];
    expect(week.filter((b) => b.workout === 'Legs')).toHaveLength(1);
    expect(week).toHaveLength(7);
  });

  it('leaves every OTHER day exactly as it was', () => {
    const before = bars([]) ?? [];
    const after = bars([claim('2026-08-12', 'Legs')]) ?? [];
    for (let i = 0; i < 7; i++) {
      if (after[i].date === '2026-08-12') continue;
      expect(after[i]).toEqual(before[i]);
    }
  });

  it('a real finish marker still outranks a claim', () => {
    // Both true is contradictory; the marker is the stronger statement (the
    // athlete pressed FINISH on that date) and statusForMarked decides.
    const wed = bars(
      [claim('2026-08-12', 'Legs')],
      [{ id: 'm1', date: '2026-08-12', workout: 'Legs' }]
    )?.find((b) => b.date === '2026-08-12');
    expect(wed?.locked).toBe(true);
    expect(wed?.status).toBe('partial'); // done 0 of 6 — explicitly finished early
  });
});
