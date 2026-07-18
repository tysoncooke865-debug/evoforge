/**
 * IMPROVEMENT_PLAN #11: the scheduled streak, computed from persisted rows —
 * never a stored counter. Effective-dated schedules: each past day is judged
 * against the plan in force THEN. Rest days bridge (never extend, never
 * reset); today stays pending until a set lands.
 *
 * DATES: this app's convention is toISOString().slice(0,10) everywhere
 * (workout_log.date is written from it), so the streak uses the SAME
 * convention — consistency with the log beats wall-clock purity, and the
 * coin guard tolerates ±1 day of skew. Day-of-week derives from the same
 * UTC reading.
 *
 * The SQL mirror is migrations/012's scheduled_streak() — keep them in
 * lockstep (both files carry this comment).
 */

import { isCountedSet } from './workouts';
import type { WorkoutRow } from './summary';

export interface ScheduleRow {
  effective_from: string; // YYYY-MM-DD
  plan: Record<string, string>; // keys '0'..'6' (getUTCDay), values day name | 'Rest'
}

export type DayState = 'completed' | 'missed' | 'rest' | 'pending' | 'future';

export interface ScheduledStreak {
  current: number;
  best: number;
  runStart: string | null;
  days: Map<string, DayState>;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dowOf = (iso: string): string => String(new Date(`${iso}T00:00:00Z`).getUTCDay());

/** The plan in force on a given day: the latest row effective on or before
 *  it. `sorted` must be ascending by effective_from. */
const planInForce = (sorted: ScheduleRow[], iso: string): Record<string, string> | null => {
  let found: Record<string, string> | null = null;
  for (const s of sorted) {
    if (s.effective_from <= iso) found = s.plan;
    else break;
  }
  return found;
};

export function computeScheduledStreak(
  schedules: ScheduleRow[],
  workoutRows: WorkoutRow[],
  todayIso: string,
  windowDays = 180
): ScheduledStreak {
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const planFor = (iso: string): Record<string, string> | null => planInForce(sorted, iso);

  const trained = new Set<string>();
  for (const r of workoutRows) {
    if (isCountedSet(r.weight, r.reps)) trained.add(String(r.date));
  }

  const days = new Map<string, DayState>();
  const start = addDays(todayIso, -windowDays);
  for (let iso = start; iso <= todayIso; iso = addDays(iso, 1)) {
    const plan = planFor(iso);
    const assigned = plan?.[dowOf(iso)];
    if (!plan || !assigned || assigned === 'Rest') {
      days.set(iso, 'rest');
    } else if (trained.has(iso)) {
      days.set(iso, 'completed');
    } else if (iso === todayIso) {
      days.set(iso, 'pending');
    } else {
      days.set(iso, 'missed');
    }
  }

  // Current run: walk back from today; rest/pending bridge, missed breaks.
  let current = 0;
  let runStart: string | null = null;
  for (let iso = todayIso; iso >= start; iso = addDays(iso, -1)) {
    const state = days.get(iso);
    if (state === 'completed') {
      current += 1;
      runStart = iso;
    } else if (state === 'rest' || state === 'pending') {
      continue;
    } else {
      break;
    }
  }

  // Best run over the window.
  let best = 0;
  let run = 0;
  for (let iso = start; iso <= todayIso; iso = addDays(iso, 1)) {
    const state = days.get(iso);
    if (state === 'completed') {
      run += 1;
      if (run > best) best = run;
    } else if (state === 'missed') {
      run = 0;
    }
    // rest/pending: bridge
  }
  if (current > best) best = current;

  return { current, best, runStart, days };
}

export interface NextSession {
  date: string; // YYYY-MM-DD
  day: string; // the plan's day name
  inDays: number; // 1 = tomorrow
}

/** TRANSFORM P4: the next non-Rest scheduled day strictly AFTER todayIso —
 *  the ceremony's "confirm next session" phase reads it. Effective-dating
 *  honoured: each future day is judged against the plan in force THEN
 *  (a reschedule saved today changes tomorrow, not history). Null when no
 *  schedule exists or the horizon holds only Rest. */
export function nextScheduledSession(
  schedules: ScheduleRow[],
  todayIso: string,
  horizonDays = 14
): NextSession | null {
  if (schedules.length === 0) return null;
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  for (let i = 1; i <= horizonDays; i++) {
    const iso = addDays(todayIso, i);
    const assigned = planInForce(sorted, iso)?.[dowOf(iso)];
    if (assigned && assigned !== 'Rest') return { date: iso, day: assigned, inDays: i };
  }
  return null;
}

export interface WeekDayPip {
  date: string; // YYYY-MM-DD
  state: DayState;
  assigned: string | null; // plan day name, null when no plan / 'Rest'
}

export interface WeeklyContract {
  /** Scheduled sessions completed this week. */
  done: number;
  /** Scheduled (non-Rest) sessions this week. */
  target: number;
  /** Monday-start, always 7 entries. */
  pips: WeekDayPip[];
}

/** TRANSFORM P5: this week's contract — Monday-start (UTC, matching the
 *  app's toISOString date convention), judged against the plan in force
 *  on each day. A session trained on a Rest day shows as completed but
 *  never counts toward the target (honest bonus, not quota). */
export function weeklyContract(
  schedules: ScheduleRow[],
  workoutRows: WorkoutRow[],
  todayIso: string
): WeeklyContract {
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const trained = new Set<string>();
  for (const r of workoutRows) {
    if (isCountedSet(r.weight, r.reps)) trained.add(String(r.date));
  }

  const monday = addDays(todayIso, -((Number(dowOf(todayIso)) + 6) % 7));
  const pips: WeekDayPip[] = [];
  let done = 0;
  let target = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    const raw = planInForce(sorted, iso)?.[dowOf(iso)];
    const assigned = raw && raw !== 'Rest' ? raw : null;
    let state: DayState;
    if (trained.has(iso)) {
      state = 'completed';
    } else if (!assigned) {
      state = iso > todayIso ? 'future' : 'rest';
    } else if (iso < todayIso) {
      state = 'missed';
    } else if (iso === todayIso) {
      state = 'pending';
    } else {
      state = 'future';
    }
    if (assigned) {
      target += 1;
      if (state === 'completed') done += 1;
    }
    pips.push({ date: iso, state, assigned });
  }
  return { done, target, pips };
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

/** The dedupe keys of every milestone this run has crossed. */
export function crossedMilestones(streak: ScheduledStreak): string[] {
  if (!streak.runStart) return [];
  return STREAK_MILESTONES.filter((m) => streak.current >= m).map((m) => `${m}:${streak.runStart}`);
}
