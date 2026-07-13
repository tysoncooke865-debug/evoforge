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

import type { ScheduleRow } from './scheduled-streak';

export type WorkoutStatus = 'completed' | 'missed' | 'in_progress' | 'upcoming' | 'rest';

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
}

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

/** The schedule row in force ON a date: the last one effective on or before it. */
export function scheduledDayFor(date: string, rows: readonly ScheduleRow[]): string | null {
  let plan: Record<string, string> | null = null;
  for (const r of [...rows].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))) {
    if (r.effective_from <= date) plan = r.plan;
    else break;
  }
  if (!plan) return null;
  const assigned = plan[String(dowOf(date))];
  return assigned && assigned !== 'Rest' ? assigned : null;
}

/**
 * The Monday-start week containing todayIso, as seven bars.
 *
 * Returns NULL when no schedule is in force — the caller falls back to the day
 * chips. A week of bars with nothing scheduled in them would be seven rest days
 * and a lie about what the athlete is meant to be doing.
 */
export function buildWeekBars(
  scheduleRows: readonly ScheduleRow[],
  sessions: readonly SessionMarker[],
  hasValidSets: (date: string, workout: string) => boolean,
  todayIso: string
): WeekBar[] | null {
  if (scheduleRows.length === 0) return null;

  const monday = addDays(todayIso, -((dowOf(todayIso) + 6) % 7));
  const markers = new Map<string, SessionMarker>();
  for (const s of sessions) markers.set(`${s.date}|${s.workout}`, s);

  const bars: WeekBar[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const workout = scheduledDayFor(date, scheduleRows);

    if (workout === null) {
      bars.push({ date, dow: dowOf(date), workout: null, status: 'rest', sessionId: null, locked: false });
      continue;
    }

    const marker = markers.get(`${date}|${workout}`) ?? null;
    const trained = hasValidSets(date, workout);

    let status: WorkoutStatus;
    if (marker) status = 'completed';
    else if (date > todayIso) status = 'upcoming';
    else if (date === todayIso) status = 'in_progress';
    else if (trained) status = 'completed'; // pre-marker history stays green
    else status = 'missed';

    bars.push({
      date,
      dow: dowOf(date),
      workout,
      status,
      sessionId: marker?.id ?? null,
      // LOCKING KEYS ONLY ON THE MARKER — see the header.
      locked: marker !== null,
    });
  }
  return bars;
}

/** Today's bar, if the week has one. */
export function todayBar(bars: WeekBar[] | null, todayIso: string): WeekBar | null {
  return bars?.find((b) => b.date === todayIso) ?? null;
}

export const STATUS_LABEL: Readonly<Record<WorkoutStatus, string>> = {
  completed: 'COMPLETED',
  missed: 'MISSED',
  in_progress: 'IN PROGRESS',
  upcoming: '—',
  rest: 'REST',
};
