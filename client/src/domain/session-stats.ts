/**
 * THE CANONICAL COMPLETED-SESSION CALCULATION.
 *
 * THE BUG (Tyson, 2026-08-06): "a completed strength workout records sets,
 * volume, XP and cardio correctly, but Home and Progress can still show
 * WORKOUTS 0 / 1 and SESSIONS 0 / 1."
 *
 * There were THREE different answers to "how many sessions?", none of them
 * agreeing, and every one of them wrong in a different direction:
 *
 *   weeklyContract().done   — a distinct DATE carrying a counted set, but ONLY
 *                             on a day the schedule assigned. Train off-plan and
 *                             the pip went green while the counter said 0. It
 *                             never looked at cardio, and never looked at the
 *                             FINISH marker.
 *   periodTotals().sessions — distinct dates with a counted STRENGTH set. A
 *                             cardio-only day read "0 SESSIONS" on the same card
 *                             that read "30 CARDIO MIN".
 *   computeStreak()         — distinct dates with `weight > 0 && reps > 0`,
 *                             which is NOT isCountedSet: 0 kg bodyweight work
 *                             counts everywhere else in the app and nowhere in
 *                             the streak. A push-up athlete had no streak.
 *
 * ONE definition now, and every surface reads it.
 *
 * WHAT COUNTS AS COMPLETED
 *
 *   A STRENGTH session is one distinct (date, workout) pair that either holds
 *   at least one counted set, or carries an explicit FINISH marker. The marker
 *   alone is enough: week-status.ts's doctrine is that "a marker is the
 *   decision and outranks inference", and it is what lets a workout whose sets
 *   all failed the predicate still count when the athlete said they were done.
 *
 *   A CARDIO session is one cardio_log row. That table has no partial state —
 *   the row exists because a session was saved.
 *
 *   An ABANDONED workout is neither: no counted set and no marker means nothing
 *   happened, and inventing a session for an opened-and-closed logger would be
 *   the mirror of the bug this file fixes.
 *
 * WHAT IS NOT DOUBLE-COUNTED
 *
 *   Keys are deduped, so twenty sets in one workout are one session and saving
 *   the same workout twice is still one. `days` counts distinct DATES, so a day
 *   holding both a lift and a run is ONE training day while remaining one
 *   strength session and one cardio session in the breakdown. Every counter in
 *   the app that means "how often did I train" reads `days`; the ones that mean
 *   "how much of each" read the breakdown.
 *
 * Pure, and idempotent by construction: the same rows always give the same
 * answer, which is what makes it safe to recompute on every render and after
 * every optimistic write.
 */

import type { CardioRow, WorkoutRow } from './summary';
import { isCountedSet } from './workouts';
import { pyFloat } from './py';

export type SessionKind = 'strength' | 'cardio';

export interface CompletedSession {
  /** The athlete's LOCAL calendar date, as stored on the row. */
  date: string;
  kind: SessionKind;
  /** The workout name for strength; the activity type for cardio. */
  name: string;
  /** Counted sets — always 0 for cardio. */
  sets: number;
  /** Σ weight × reps over counted sets, kg. Always 0 for cardio. */
  volumeKg: number;
  /** Minutes — always 0 for strength. */
  minutes: number;
  /** True when the athlete explicitly finished it (a `workout_sessions` row). */
  finished: boolean;
}

export interface SessionStats {
  /** Completed strength workouts. */
  strength: number;
  /** Completed cardio sessions. */
  cardio: number;
  /**
   * Distinct calendar days holding at least one completed session — the
   * "how often did I train" number. A day with both counts ONCE.
   */
  days: number;
  /** strength + cardio. Deliberately NOT the same as `days`. */
  total: number;
  /** Every session, ascending by date then name. */
  sessions: CompletedSession[];
  /** The dates in `days`, for callers that need set membership. */
  dates: Set<string>;
}

export interface SessionMarkerLike {
  date: string;
  workout: string;
}

export interface CompletedSessionsInput {
  workoutRows: readonly WorkoutRow[];
  cardioRows?: readonly CardioRow[];
  /** `workout_sessions` finish markers. Absent = derive from sets alone. */
  finishes?: readonly SessionMarkerLike[];
  /** Inclusive window. Omit both for "all of history". */
  fromIso?: string | null;
  toIso?: string | null;
}

const inWindow = (date: string, from: string | null, to: string | null): boolean =>
  date !== '' && (from === null || date >= from) && (to === null || date <= to);

export const EMPTY_SESSION_STATS: SessionStats = {
  strength: 0,
  cardio: 0,
  days: 0,
  total: 0,
  sessions: [],
  dates: new Set<string>(),
};

/**
 * Every completed session in the window. THE one calculation — Home's weekly
 * summary, Progress, the streaks, the achievement sweep and the history
 * summaries all call this and none of them re-derive it.
 */
export function completedSessions(input: CompletedSessionsInput): SessionStats {
  const from = input.fromIso ?? null;
  const to = input.toIso ?? null;

  // (date|workout) → the session being accumulated. The Map IS the dedupe:
  // twenty sets, or the same workout saved twice, collapse to one entry.
  const strength = new Map<string, CompletedSession>();

  const touch = (date: string, name: string): CompletedSession => {
    const key = `${date}|${name}`;
    let s = strength.get(key);
    if (!s) {
      s = { date, kind: 'strength', name, sets: 0, volumeKg: 0, minutes: 0, finished: false };
      strength.set(key, s);
    }
    return s;
  };

  for (const r of input.workoutRows) {
    const date = String(r.date ?? '');
    if (!inWindow(date, from, to)) continue;
    if (!isCountedSet(r.weight, r.reps)) continue; // abandoned/garbage rows never count
    const s = touch(date, String(r.workout ?? ''));
    s.sets += 1;
    s.volumeKg += (pyFloat(r.weight) ?? 0) * (pyFloat(r.reps) ?? 0);
  }

  // A finish marker is a DECISION and outranks inference — it can create a
  // session the log alone would have missed, and it can only ever mark an
  // existing one as finished. It never removes one.
  for (const m of input.finishes ?? []) {
    const date = String(m.date ?? '');
    if (!inWindow(date, from, to)) continue;
    touch(date, String(m.workout ?? '')).finished = true;
  }

  const sessions: CompletedSession[] = [...strength.values()];

  for (const c of input.cardioRows ?? []) {
    const date = String(c.date ?? '');
    if (!inWindow(date, from, to)) continue;
    const minutes = pyFloat(c.minutes) ?? 0;
    sessions.push({
      date,
      kind: 'cardio',
      name: String(c.type ?? 'Cardio'),
      sets: 0,
      volumeKg: 0,
      minutes,
      // A cardio row only exists because the session was saved. There is no
      // half-saved cardio, so there is nothing for a marker to add.
      finished: true,
    });
  }

  sessions.sort((a, b) =>
    a.date === b.date ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.date < b.date ? -1 : 1
  );

  const dates = new Set(sessions.map((s) => s.date));
  const strengthCount = sessions.filter((s) => s.kind === 'strength').length;
  const cardioCount = sessions.length - strengthCount;

  return {
    strength: strengthCount,
    cardio: cardioCount,
    days: dates.size,
    total: sessions.length,
    sessions,
    dates,
  };
}

/**
 * Did the athlete complete a session on this date? The single predicate behind
 * every "did I train" pip, bar, streak day and weekly counter.
 */
export function trainedOn(stats: SessionStats, iso: string): boolean {
  return stats.dates.has(iso);
}
