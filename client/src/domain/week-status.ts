/**
 * THE WEEK'S WORKOUTS, AND WHETHER THEY HAPPENED (TRAIN_IMPROVEMENTS.md).
 *
 * Two rules, and the whole feature turns on keeping them apart:
 *
 *   STATUS derives WITHOUT needing a finish marker. No historical workout has
 *   one, and inventing markers for a year of history would be fiction. A past
 *   day with sets logged is COMPLETED, marker or not.
 *
 *   LOCKING keys ONLY on the marker. History stays editable exactly as it is
 *   today; only an explicit FINISH locks anything.
 *
 * Conflate them and you either lock a year of history nobody agreed to lock, or
 * you show every pre-feature workout as MISSED. Both are lies about the past.
 */

import { dayWorkouts, type PlanDayValue, type ScheduleRow } from './scheduled-streak';
import { isCountedSet } from './workouts';

export type WorkoutStatus = 'completed' | 'partial' | 'missed' | 'in_progress' | 'upcoming' | 'rest';

/**
 * TRAIN_OVERHAUL — how much of a day happened, not just whether it did.
 *
 * `done`/`target` are the plan-matched fraction the bar displays (sets logged
 * against what the plan asks, capped per exercise). `trained` is the OLD
 * boolean — ANY valid set for (date, workout) — and it stays separate on
 * purpose: an athlete who swapped every exercise has done=0 against the plan
 * but absolutely trained, and deriving "trained" from done>0 would flip a day
 * of real history from COMPLETED to MISSED. done>0 implies trained; never the
 * reverse.
 */
export interface DayProgress {
  done: number;
  target: number;
  trained: boolean;
}

export interface WeekBar {
  date: string; // YYYY-MM-DD
  dow: number; // 0..6, getUTCDay
  /** The scheduled workout, or null on a rest/unscheduled day. */
  workout: string | null;
  status: WorkoutStatus;
  /** The finish marker's id, when one exists — REOPEN deletes by it. */
  sessionId: string | null;
  /** LOCKED = explicitly finished. Never true from derivation alone. */
  locked: boolean;
  /** Plan-matched sets logged / asked for — the bar's fraction. */
  done: number;
  target: number;
}

/**
 * PARTIAL = the athlete SAID they were done (the marker) while the plan says
 * there was more (done < target). Derivation alone never yields it: a past
 * unmarked day is completed-or-missed exactly as before, because inventing
 * "you stopped early" for history nobody finished-early is a lie about the
 * past. A partial day is still LOCKED — it was explicitly finished.
 */
const statusForMarked = (p: DayProgress): WorkoutStatus =>
  p.target > 0 && p.done < p.target ? 'partial' : 'completed';

export interface SessionMarker {
  id: string;
  date: string;
  workout: string;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dowOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

const planInForceOn = (
  date: string,
  rows: readonly ScheduleRow[]
): Record<string, PlanDayValue> | null => {
  let plan: Record<string, PlanDayValue> | null = null;
  for (const r of [...rows].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))) {
    if (r.effective_from <= date) plan = r.plan;
    else break;
  }
  return plan;
};

/** The schedule row in force ON a date: the last one effective on or before
 *  it. 065: a slot may hold [primary, ...extras] — this returns the FIRST
 *  non-Rest entry (a ['Rest','Core'] Sunday IS a Core day everywhere the
 *  primary shows); scheduledExtrasFor returns the rest. */
export function scheduledDayFor(date: string, rows: readonly ScheduleRow[]): string | null {
  const plan = planInForceOn(date, rows);
  if (!plan) return null;
  return dayWorkouts(plan[String(dowOf(date))])[0] ?? null;
}

/** The date's EXTRA scheduled workouts — everything after the promoted
 *  primary. Literal names on purpose: extras are explicit picks (often
 *  routines) and must never be renamed by a plan-source switch. */
export function scheduledExtrasFor(date: string, rows: readonly ScheduleRow[]): string[] {
  const plan = planInForceOn(date, rows);
  if (!plan) return [];
  return dayWorkouts(plan[String(dowOf(date))]).slice(1);
}

/**
 * The scheduled day for `date`, renamed into the CHOSEN plan source
 * (Tyson, 2026-07-15: "changing the workout type only changed completed/
 * partial rows — current and upcoming didn't"). Three rules:
 *
 *   HISTORY IS HISTORY: a past date keeps the name that was actually
 *   scheduled — a source switch must not rewrite what happened.
 *
 *   A WEEK THE SOURCE OWNS STAYS: if EVERY training day this week is one of
 *   the chosen plan's days, the stored schedule is that plan's own
 *   arrangement — keep it. Deliberately per-WEEK, not per-day: plans share
 *   day names ("Legs" exists in all three of Tyson's plans), and the per-day
 *   rule froze the title on a collision while the exercises switched
 *   underneath — the glitch this comment exists to prevent again.
 *
 *   OTHERWISE REMAP POSITIONALLY: the week's nth training slot takes the
 *   source's nth day (cycling when the source has fewer days) — switching
 *   to a 3-day plan on a 6-slot week repeats it, never blanks it.
 *
 * Rest days stay rest days: the SLOTS are the athlete's schedule; only the
 * NAMES follow the source.
 */
export function sourceDayFor(
  date: string,
  scheduleRows: readonly ScheduleRow[],
  sourceDays: readonly string[],
  todayIso: string
): string | null {
  const scheduled = scheduledDayFor(date, scheduleRows);
  if (!scheduled) return null;
  if (date < todayIso) return scheduled; // history is history
  if (sourceDays.length === 0) return scheduled;
  // This date's Monday-start week: which slot is `date`, and does the source
  // own the WHOLE week's names?
  const monday = addDays(date, -((dowOf(date) + 6) % 7));
  let slot = 0;
  let ownsWeek = true;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const name = scheduledDayFor(d, scheduleRows);
    if (d < date && name) slot++;
    if (name && !sourceDays.includes(name)) ownsWeek = false;
  }
  return ownsWeek ? scheduled : sourceDays[slot % sourceDays.length];
}

/**
 * The Monday-start week containing todayIso, as seven bars.
 *
 * Returns NULL when no schedule is in force — the caller falls back to the day
 * chips. A week of bars with nothing scheduled in them would be seven rest days
 * and a lie about what the athlete is meant to be doing.
 *
 * `dayFor` overrides which workout NAME a date carries (the source remap);
 * omitted, the stored schedule speaks.
 */
export function buildWeekBars(
  scheduleRows: readonly ScheduleRow[],
  sessions: readonly SessionMarker[],
  progressFor: (date: string, workout: string) => DayProgress,
  todayIso: string,
  dayFor?: (date: string) => string | null
): WeekBar[] | null {
  if (scheduleRows.length === 0) return null;

  const monday = addDays(todayIso, -((dowOf(todayIso) + 6) % 7));
  const markers = new Map<string, SessionMarker>();
  for (const s of sessions) markers.set(`${s.date}|${s.workout}`, s);

  const bars: WeekBar[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const workout = dayFor ? dayFor(date) : scheduledDayFor(date, scheduleRows);

    if (workout === null) {
      bars.push({ date, dow: dowOf(date), workout: null, status: 'rest', sessionId: null, locked: false, done: 0, target: 0 });
      continue;
    }

    const marker = markers.get(`${date}|${workout}`) ?? null;
    const progress = progressFor(date, workout);

    let status: WorkoutStatus;
    if (marker) status = statusForMarked(progress);
    else if (date > todayIso) status = 'upcoming';
    else if (date === todayIso) status = 'in_progress';
    else if (progress.trained) status = 'completed'; // pre-marker history stays green
    else status = 'missed';

    bars.push({
      date,
      dow: dowOf(date),
      workout,
      status,
      sessionId: marker?.id ?? null,
      // LOCKING KEYS ONLY ON THE MARKER — see the header. PARTIAL is locked
      // too: it was explicitly finished.
      locked: marker !== null,
      done: progress.done,
      target: progress.target,
    });
  }
  return bars;
}

/** Today's bar, if the week has one. */
export function todayBar(bars: WeekBar[] | null, todayIso: string): WeekBar | null {
  return bars?.find((b) => b.date === todayIso) ?? null;
}

/**
 * 065 — the week's EXTRA scheduled workouts, as bars keyed by date.
 *
 * Rendered directly beneath each day's primary bar. Status follows
 * buildWeekBars' exact rules — in particular TODAY's extras are
 * `in_progress`, which is what lights them accent-blue alongside the
 * primary (WeekBarRow keys the highlight on that status alone). The
 * 7-bar contract of buildWeekBars itself is untouched.
 */
export function extraScheduledBars(
  scheduleRows: readonly ScheduleRow[],
  sessions: readonly SessionMarker[],
  progressFor: (date: string, workout: string) => DayProgress,
  todayIso: string
): Map<string, WeekBar[]> {
  const out = new Map<string, WeekBar[]>();
  if (scheduleRows.length === 0) return out;

  const monday = addDays(todayIso, -((dowOf(todayIso) + 6) % 7));
  const markers = new Map<string, SessionMarker>();
  for (const s of sessions) markers.set(`${s.date}|${s.workout}`, s);

  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const extras = scheduledExtrasFor(date, scheduleRows);
    if (extras.length === 0) continue;

    const bars: WeekBar[] = extras.map((workout) => {
      const marker = markers.get(`${date}|${workout}`) ?? null;
      const progress = progressFor(date, workout);

      let status: WorkoutStatus;
      if (marker) status = statusForMarked(progress);
      else if (date > todayIso) status = 'upcoming';
      else if (date === todayIso) status = 'in_progress';
      else if (progress.trained) status = 'completed';
      else status = 'missed';

      return {
        date,
        dow: dowOf(date),
        workout,
        status,
        sessionId: marker?.id ?? null,
        locked: marker !== null,
        done: progress.done,
        target: progress.target,
      };
    });
    out.set(date, bars);
  }
  return out;
}

export const STATUS_LABEL: Readonly<Record<WorkoutStatus, string>> = {
  completed: 'COMPLETED',
  partial: 'PARTIAL',
  missed: 'MISSED',
  in_progress: 'IN PROGRESS',
  upcoming: '—',
  rest: 'REST',
};

/**
 * TRAIN_PAGE_V2 — the workouts that are NOT on the schedule.
 *
 * An ad-hoc workout ("Beach Day"), or a scheduled day the athlete swapped away
 * from, has no bar in the week — so finishing one left it with NO HOME on
 * Train: green nowhere, reachable nowhere. These are the extra bars for today.
 *
 * Only TODAY: a past off-schedule workout is history, and the week bars are
 * about what the athlete is doing now. Rendered after the seven.
 *
 * `scheduledNames` is EVERY name that already owns a bar today — the primary,
 * its source-remapped alias, and the 065 extras — so a scheduled extra that
 * was trained never grows a duplicate ad-hoc bar.
 */
export function extraBarsForToday(
  rows: readonly { date?: unknown; workout?: unknown; weight?: unknown; reps?: unknown }[],
  sessions: readonly SessionMarker[],
  adhocName: string | null,
  scheduledNames: readonly string[],
  todayIso: string,
  progressFor: (date: string, workout: string) => DayProgress = () => ({ done: 0, target: 0, trained: false })
): WeekBar[] {
  const names = new Set<string>();
  const scheduled = new Set(scheduledNames);

  // Anything trained today that is not a scheduled workout.
  for (const r of rows) {
    if (String(r.date ?? '') !== todayIso) continue;
    const w = String(r.workout ?? '');
    if (w === '' || scheduled.has(w)) continue;
    if (!isCountedSet(r.weight, r.reps)) continue;
    names.add(w);
  }
  // Anything FINISHED today that is not a scheduled workout (a finish with no
  // sets cannot happen, but a marker is the decision and outranks inference).
  for (const m of sessions) {
    if (m.date === todayIso && !scheduled.has(m.workout)) names.add(m.workout);
  }
  // The workout in progress right now, even before its first set lands.
  if (adhocName !== null && !scheduled.has(adhocName)) names.add(adhocName);

  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
  return [...names].map((workout) => {
    const marker = sessions.find((m) => m.date === todayIso && m.workout === workout) ?? null;
    const progress = progressFor(todayIso, workout);
    return {
      date: todayIso,
      dow,
      workout,
      // Same rule as the week: a finish with less than the plan asked is
      // PARTIAL; in-progress days stay in progress.
      status: marker ? statusForMarked(progress) : ('in_progress' as const),
      sessionId: marker?.id ?? null,
      locked: marker !== null,
      done: progress.done,
      target: progress.target,
    };
  });
}
