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

import { pyFloat } from './py';
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

export function computeScheduledStreak(
  schedules: ScheduleRow[],
  workoutRows: WorkoutRow[],
  todayIso: string,
  windowDays = 180
): ScheduledStreak {
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const planFor = (iso: string): Record<string, string> | null => {
    let found: Record<string, string> | null = null;
    for (const s of sorted) {
      if (s.effective_from <= iso) found = s.plan;
      else break;
    }
    return found;
  };

  const trained = new Set<string>();
  for (const r of workoutRows) {
    const w = pyFloat(r.weight) ?? 0;
    const reps = pyFloat(r.reps) ?? 0;
    if (w > 0 && reps > 0) trained.add(String(r.date));
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

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

/** The dedupe keys of every milestone this run has crossed. */
export function crossedMilestones(streak: ScheduledStreak): string[] {
  if (!streak.runStart) return [];
  return STREAK_MILESTONES.filter((m) => streak.current >= m).map((m) => `${m}:${streak.runStart}`);
}
