import type { ScheduleRow } from './scheduled-streak';
import { scheduledDayFor, sourceDayFor } from './week-status';

/**
 * THE CANONICAL SESSION STATUS — one answer, for every surface (2026-08-11).
 *
 * ---- THE CONTRADICTION THIS ENDS ----
 *
 * A live audit found Home showing all of this at once:
 *
 *     TODAY'S PLAN: REST
 *     IN PROGRESS · UPPER POWER
 *     17/17 SETS COMPLETED
 *     [ RESUME MISSION ]
 *
 * while Train, on the same data, showed the workout COMPLETED. Four statements,
 * three of them wrong, on one screen. There were three separate causes and it
 * is worth naming each, because only one of them is what it looks like:
 *
 * 1. THE TWO SCREENS RESOLVED DIFFERENT WORKOUT NAMES. Train's `dayInSource`
 *    honours the today-only DAY SWAP and the per-day SOURCE map (migration
 *    066) before falling through to `sourceDayFor`. Home called `sourceDayFor`
 *    directly and saw neither. Finish markers are keyed (date, workout), so
 *    the moment the two names differed Home's marker lookup missed and the
 *    session read as unfinished — while Train, using the other name, found it.
 *    THIS is the "completed on one screen, in progress on the other" bug.
 *
 * 2. THERE WAS NO `ready_to_finish`. Home had `in_progress` for anything with
 *    a logged set and no marker, so 17 of 17 sets read exactly like 1 of 17
 *    and the button said RESUME. An athlete who has done every set is not
 *    resuming anything; they are one tap from done.
 *
 * 3. `TODAY'S PLAN: REST` came from a different clock entirely — the cache
 *    card's server state used the UTC date while everything else uses the
 *    athlete's local one, so before 10am in Sydney it described YESTERDAY.
 *    Fixed at the source in migration 198.
 *
 * ---- WHY THIS IS A PURE MODULE AND NOT A NEW RPC ----
 *
 * The brief asks Home and Train to "query the same server-side source of
 * truth". They already do: `workout_log`, `workout_sessions`, `workout_schedule`
 * and `user_plans`. What they did NOT share was the DERIVATION, and that is
 * where they disagreed.
 *
 * Moving that derivation into SQL would mean reimplementing plan resolution —
 * three plan sources, the per-day source map, the day swap, ad-hoc sessions
 * and the whole session override layer — in a second language, and keeping the
 * two in step forever. That is the drift this file exists to remove, recreated
 * one level down. So there is ONE derivation, here, fed by the same server
 * rows, and both screens call it. Nothing else may decide these questions.
 */

export type SessionStatus =
  /** Scheduled, nothing logged. */
  | 'planned'
  /** Some sets logged, more owed. */
  | 'in_progress'
  /** Every planned set logged, FINISH not yet pressed. */
  | 'ready_to_finish'
  /** The athlete pressed FINISH. The marker exists. */
  | 'completed'
  /** Explicitly abandoned. Never derived — only ever recorded. */
  | 'cancelled';

/* ───────────────────────── the day's name, once ────────────────────────── */

export interface PlannedDayInput {
  date: string;
  todayIso: string;
  scheduleRows: readonly ScheduleRow[];
  /** The chosen plan's day names, in plan order. */
  planDays: readonly string[];
  /** "SWAP TODAY'S DAY" — today-only, self-expiring. Outranks everything. */
  daySwap?: string | null;
  /** True when this date has an EXPLICIT per-day source (migration 066). The
   *  stored name already belongs to that source, so the positional remap must
   *  not touch it. */
  hasExplicitSource?: boolean;
}

/**
 * WHICH WORKOUT DOES THIS DATE CARRY? — the single resolution both screens use.
 *
 * Extracted verbatim from Train's `dayInSource`, which was the correct one.
 * Home had only the third branch, and that omission is bug 1 above.
 */
export function resolvePlannedDay(input: PlannedDayInput): string | null {
  // A "just for today" trade outranks the schedule entirely: it is deliberately
  // today-only and expires at midnight, leaving no trace.
  if (input.date === input.todayIso && input.daySwap) return input.daySwap;
  // A day with an explicit per-day source stores a name already correct for
  // that source, so the global positional remap must not rename it.
  if (input.hasExplicitSource) return scheduledDayFor(input.date, input.scheduleRows);
  return sourceDayFor(input.date, input.scheduleRows, input.planDays, input.todayIso);
}

/* ─────────────────────────── the status, once ──────────────────────────── */

export interface SessionFacts {
  /** The workout this date carries, from resolvePlannedDay. Null = rest. */
  workout: string | null;
  /** Sets the plan asks for. 0 when the session is ad-hoc or unplanned. */
  targetSets: number;
  /** Counted sets logged for (date, workout). */
  doneSets: number;
  /** A finish marker exists for (date, workout). */
  finished: boolean;
  /** Recorded, never derived. */
  cancelled?: boolean;
  /** The athlete opened the session without logging yet (migration 138). A
   *  workout can be genuinely under way with zero sets. */
  opened?: boolean;
}

/**
 * THE ONE RULE SET.
 *
 * Order is the whole specification, and the first two lines are the audit's
 * findings turned into code:
 *
 *   - `finished` wins over everything. A completed workout can NEVER read as
 *     in progress, whatever the set counts say.
 *   - every planned set logged, no marker -> READY TO FINISH, never RESUME.
 */
export function sessionStatus(f: SessionFacts): SessionStatus {
  if (f.cancelled) return 'cancelled';
  // RULE 1. Checked first, and before any set arithmetic, so there is no path
  // by which a completed session reports anything else.
  if (f.finished) return 'completed';
  if (f.workout === null) return 'planned';

  const done = Math.max(0, f.doneSets);
  const target = Math.max(0, f.targetSets);

  // RULE 2. `target > 0` matters: an ad-hoc session with no plan has target 0,
  // and "0 of 0 sets" is not a finished workout — it is one that has not
  // started. Without that guard every empty session would offer FINISH.
  if (target > 0 && done >= target) return 'ready_to_finish';
  if (done > 0 || f.opened) return 'in_progress';
  return 'planned';
}

/** Has this session been through the whole loop? The only thing progress
 *  statistics may count (§1: "genuine completed sessions"). */
export function isCompleted(status: SessionStatus): boolean {
  return status === 'completed';
}

/* ─────────────────────────── what the button says ──────────────────────── */

/**
 * ONE label per status, so Home and Train cannot word the same state two ways.
 * `RESUME` is deliberately absent from `ready_to_finish` — that mismatch is
 * the second half of the reported bug.
 */
export const SESSION_CTA: Readonly<Record<SessionStatus, string>> = {
  planned: 'START WORKOUT',
  in_progress: 'RESUME WORKOUT',
  ready_to_finish: 'FINISH WORKOUT',
  completed: 'VIEW WORKOUT',
  cancelled: 'START WORKOUT',
};

/** The kicker above the title. */
export const SESSION_KICKER: Readonly<Record<SessionStatus, string>> = {
  planned: "TODAY'S MISSION",
  in_progress: 'IN PROGRESS',
  ready_to_finish: 'READY TO FINISH',
  completed: 'COMPLETED',
  cancelled: "TODAY'S MISSION",
};

/* ──────────────────────── rest days and extra sessions ─────────────────── */

export interface RestDayFacts {
  /** The plan says this date is rest. */
  isPlannedRest: boolean;
  /** A session with logged sets exists on this date anyway. */
  sessionWorkout: string | null;
}

export type DayKind =
  | { kind: 'rest' }
  /** Training the plan asked for. */
  | { kind: 'planned'; workout: string }
  /** Trained on a planned rest day. The REST STATE IS UNCHANGED. */
  | { kind: 'extra'; workout: string };

/**
 * §1: "a planned rest day and an in-progress planned workout cannot exist
 * simultaneously", and "an extra workout on a rest day is an optional extra
 * session rather than a change to the planned rest state."
 *
 * Both follow from one decision: on a planned rest day, a session is an
 * EXTRA — a third kind — rather than a promotion of the day to a training day.
 * The plan is not rewritten by what somebody did today, so the rest day stays
 * a rest day, the streak and the cache keep counting it as one, and the card
 * can say "extra session" without contradicting the plan beside it.
 */
export function dayKind(f: RestDayFacts): DayKind {
  if (!f.isPlannedRest) {
    return f.sessionWorkout ? { kind: 'planned', workout: f.sessionWorkout } : { kind: 'rest' };
  }
  return f.sessionWorkout ? { kind: 'extra', workout: f.sessionWorkout } : { kind: 'rest' };
}

export const DAY_KIND_LABEL: Readonly<Record<DayKind['kind'], string>> = {
  rest: 'REST DAY',
  planned: "TODAY'S PLAN",
  extra: 'EXTRA SESSION',
};

/* ──────────────────────────── progress counting ────────────────────────── */

export interface CountableSession {
  date: string;
  workout: string;
  finished: boolean;
}

/**
 * §1: "progress statistics must count only genuine completed sessions and
 * unique training days."
 *
 * A session counts when it has a FINISH MARKER — not when it has sets. Those
 * are different questions, and conflating them is how a fresh account shows
 * historical workouts as completed: any stray row with a date looked like a
 * finished session. A marker is a deliberate act and cannot be manufactured by
 * opening a screen.
 */
export function completedSessionCount(sessions: readonly CountableSession[] | undefined): number {
  let n = 0;
  for (const s of sessions ?? []) if (s.finished) n += 1;
  return n;
}

/** Distinct DAYS with a completed session. Two sessions on one day are one
 *  training day — which is why this is a set of dates and not a count. */
export function uniqueTrainingDayCount(sessions: readonly CountableSession[] | undefined): number {
  const days = new Set<string>();
  for (const s of sessions ?? []) {
    if (s.finished && s.date) days.add(s.date);
  }
  return days.size;
}
