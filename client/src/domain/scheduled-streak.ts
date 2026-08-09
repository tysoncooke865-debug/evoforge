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
 * The SQL mirror is scheduled_streak() (migrations/012, redefined by 065) —
 * keep them in lockstep (both files carry this comment).
 *
 * 065: a plan value may be an ARRAY — [primary, ...extras], slot 0 possibly
 * 'Rest', extras never. A date is SCHEDULED iff it holds at least one
 * non-Rest entry (so 'Rest' + an extra IS a training day); TRAINED stays
 * day-granular — any counted set on the date preserves the streak, whichever
 * of the day's workouts it belonged to.
 */

import { addDaysIso } from './today';
import { completedSessions, trainedOn, type CompletedSessionsInput } from './session-stats';
import type { WorkoutRow } from './summary';

/** One weekday slot: a single name (pre-065 rows and extra-less days) or
 *  [primary, ...extras]. Days with no extras SERIALIZE as plain strings —
 *  the wire stays byte-identical to pre-065 rows. */
export type PlanDayValue = string | string[];

/** All non-Rest workouts a slot holds, in stored order. [] = rest day. */
export const dayWorkouts = (v: PlanDayValue | null | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((w) => w !== '' && w !== 'Rest');

export interface ScheduleRow {
  effective_from: string; // YYYY-MM-DD
  plan: Record<string, PlanDayValue>; // keys '0'..'6' (getUTCDay), values day name(s) | 'Rest'
  // PER-DAY SOURCE (migration 066): keys '0'..'6' → SourceIndex (0 my / 1 ai /
  // 2 built-in). A PARALLEL map, applying to the day's PRIMARY workout only —
  // 065 extras keep their literal names. Every reader goes through
  // dayWorkouts(); the streak SQL is 065's array-aware body. Absent/null =
  // every day follows the global plan source, exactly as before.
  sources?: Record<string, number> | null;
}

export type DayState = 'completed' | 'missed' | 'rest' | 'pending' | 'future';

export interface ScheduledStreak {
  current: number;
  best: number;
  runStart: string | null;
  days: Map<string, DayState>;
}

const addDays = addDaysIso; // D6: the shared helper

const dowOf = (iso: string): string => String(new Date(`${iso}T00:00:00Z`).getUTCDay());

/** The plan in force on a given day: the latest row effective on or before
 *  it. `sorted` must be ascending by effective_from. */
const planInForce = (sorted: ScheduleRow[], iso: string): Record<string, PlanDayValue> | null => {
  let found: Record<string, PlanDayValue> | null = null;
  for (const s of sorted) {
    if (s.effective_from <= iso) found = s.plan;
    else break;
  }
  return found;
};

/**
 * A DECLARED BREAK for injury, illness or travel (179, Spec v5 §6).
 * `ended_on: null` means it is still running.
 */
export interface StreakPause {
  started_on: string;
  ended_on: string | null;
}

/** The server's default in `forge_streak_config`; overridden by `my_streak_state`. */
export const DEFAULT_GRACE_PER_30D = 2;

function isPaused(pauses: readonly StreakPause[], iso: string): boolean {
  for (const p of pauses) {
    if (p.started_on <= iso && (p.ended_on === null || p.ended_on >= iso)) return true;
  }
  return false;
}

export function computeScheduledStreak(
  schedules: ScheduleRow[],
  workoutRows: WorkoutRow[],
  todayIso: string,
  windowDays = 180,
  extra?: Omit<CompletedSessionsInput, 'workoutRows' | 'fromIso' | 'toIso'>,
  /**
   * 179. Optional so every existing caller keeps compiling and keeps its current
   * behaviour: no pauses and the default allowance is exactly what the rule was
   * before, plus grace. A screen that has not been taught about pauses simply
   * does not benefit from them.
   */
  opts?: { pauses?: readonly StreakPause[]; gracePer30d?: number }
): ScheduledStreak {
  const pauses = opts?.pauses ?? [];
  const gracePer30d = Math.max(0, opts?.gracePer30d ?? DEFAULT_GRACE_PER_30D);
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  const planFor = (iso: string): Record<string, PlanDayValue> | null => planInForce(sorted, iso);

  const start = addDays(todayIso, -windowDays);
  // Same canonical count as the contract — a scheduled day the athlete
  // completed by running instead of lifting is still a day they trained.
  const stats = completedSessions({
    workoutRows,
    cardioRows: extra?.cardioRows,
    finishes: extra?.finishes,
    fromIso: start,
    toIso: todayIso,
  });

  const days = new Map<string, DayState>();
  for (let iso = start; iso <= todayIso; iso = addDays(iso, 1)) {
    const plan = planFor(iso);
    const assigned = dayWorkouts(plan?.[dowOf(iso)]);
    if (!plan || assigned.length === 0) {
      days.set(iso, 'rest');
    } else if (isPaused(pauses, iso)) {
      // 179: a declared pause bridges exactly as a rest day does. Classified
      // BEFORE 'completed' is even asked, because a day you told us you were
      // injured is not a day you owed us training.
      days.set(iso, 'rest');
    } else if (trainedOn(stats, iso)) {
      days.set(iso, 'completed');
    } else if (iso === todayIso) {
      days.set(iso, 'pending');
    } else {
      days.set(iso, 'missed');
    }
  }

  /**
   * Current run: walk back from today. Rest and pending bridge; a missed planned
   * day is ABSORBED BY GRACE if any is left, and only breaks the run otherwise
   * (179, Spec v5 §6).
   *
   * The rolling window matters and is not a nicety. Counting grace per calendar
   * month would let an athlete miss the 30th, the 1st, the 2nd and the 3rd on
   * four grace days across two "months", which is not what "two a month" means to
   * anyone. A miss at `iso` is absorbed only if fewer than `gracePer30d` have
   * already been spent within the 30 days at or after it.
   *
   * THE SQL MIRROR IS `scheduled_streak` (migration 179) and the two must agree —
   * the server counts the streak for anything server-side, this counts the number
   * on the screen, and an athlete comparing them would be right to trust neither.
   */
  const spent: string[] = [];
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
      const windowEnd = addDays(iso, 30);
      const nearby = spent.filter((d) => d >= iso && d < windowEnd).length;
      if (nearby < gracePer30d) {
        spent.push(iso);
        continue;
      }
      break;
    }
  }

  /**
   * Best run over the window, under the SAME rule as the current one.
   *
   * If grace saved today's run but not the identical run last month, an athlete
   * would watch their best drop below a streak they remember finishing. Best is
   * "preserved permanently" in §6, and permanence you have to re-earn under a
   * different rule is not permanence.
   */
  let best = 0;
  let run = 0;
  const bestSpent: string[] = [];
  for (let iso = start; iso <= todayIso; iso = addDays(iso, 1)) {
    const state = days.get(iso);
    if (state === 'completed') {
      run += 1;
      if (run > best) best = run;
    } else if (state === 'missed') {
      const windowStart = addDays(iso, -30);
      const nearby = bestSpent.filter((d) => d > windowStart && d <= iso).length;
      if (nearby < gracePer30d) bestSpent.push(iso);
      else {
        run = 0;
        bestSpent.length = 0;
      }
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
    const assigned = dayWorkouts(planInForce(sorted, iso)?.[dowOf(iso)])[0];
    if (assigned) return { date: iso, day: assigned, inDays: i };
  }
  return null;
}

export interface WeekDayPip {
  date: string; // YYYY-MM-DD
  state: DayState;
  assigned: string | null; // plan day name, null when no plan / 'Rest'
}

export interface WeeklyContract {
  /**
   * Training days completed this week — scheduled or not. CAN EXCEED `target`:
   * a bonus session is honest, and showing 0 for a workout the athlete
   * demonstrably finished was the 2026-08-06 bug.
   */
  done: number;
  /** Scheduled (non-Rest) sessions this week. */
  target: number;
  /** Completed strength workouts this week (breakdown of `done`). */
  strength: number;
  /** Completed cardio sessions this week (breakdown of `done`). */
  cardio: number;
  /** Monday-start, always 7 entries. */
  pips: WeekDayPip[];
}

/**
 * TRANSFORM P5: this week's contract — Monday-start (UTC, matching the app's
 * toISOString date convention), judged against the plan in force on each day.
 *
 * DONE vs TARGET (fixed 2026-08-06). `target` is the PLAN: scheduled non-Rest
 * days, and a session trained on a rest day never inflates it (honest bonus,
 * not quota). `done` is WHAT HAPPENED: every completed training day, scheduled
 * or not. Those were once the same loop, so training off-plan lit the pip
 * green while the counter read 0 — "WORKOUTS 0 / 1" on a finished workout.
 * done > target is a legitimate week; the bar clamps, the number does not lie.
 *
 * `extra` carries cardio rows and finish markers so a completed cardio session
 * and a finished-with-no-sets workout both count. Omitted, the contract
 * degrades to strength-from-sets exactly as before — every caller that has the
 * data should pass it.
 */
export function weeklyContract(
  schedules: ScheduleRow[],
  workoutRows: WorkoutRow[],
  todayIso: string,
  extra?: Omit<CompletedSessionsInput, 'workoutRows' | 'fromIso' | 'toIso'>
): WeeklyContract {
  const sorted = [...schedules].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));

  const monday = addDays(todayIso, -((Number(dowOf(todayIso)) + 6) % 7));
  const sunday = addDays(monday, 6);
  // THE canonical count (domain/session-stats.ts) — the same one Progress,
  // the streaks and the achievement sweep read.
  const stats = completedSessions({
    workoutRows,
    cardioRows: extra?.cardioRows,
    finishes: extra?.finishes,
    fromIso: monday,
    toIso: sunday,
  });

  const pips: WeekDayPip[] = [];
  let done = 0;
  let target = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    // Day-granular on purpose: a day with extras is still ONE pip and ONE
    // session toward the weekly target — per-workout honesty lives in the
    // Train bars, not the contract.
    const assigned = dayWorkouts(planInForce(sorted, iso)?.[dowOf(iso)])[0] ?? null;
    let state: DayState;
    if (trainedOn(stats, iso)) {
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
    if (assigned) target += 1;
    // The pip and the counter read the SAME fact. They cannot disagree.
    if (state === 'completed') done += 1;
    pips.push({ date: iso, state, assigned });
  }
  return { done, target, strength: stats.strength, cardio: stats.cardio, pips };
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

/** The dedupe keys of every milestone this run has crossed. */
export function crossedMilestones(streak: ScheduledStreak): string[] {
  if (!streak.runStart) return [];
  return STREAK_MILESTONES.filter((m) => streak.current >= m).map((m) => `${m}:${streak.runStart}`);
}
