// Relative runtime imports on purpose: the vitest suite loads these fixtures
// and the test runner resolves no '@/' alias (same rule as domain/ modules).
import { ROUTINE, ROUTINE_ORDER } from '../../domain/catalogs';
import type { ScheduleRow } from '../../domain/scheduled-streak';
import type { CardioRow, WorkoutRow } from '../../domain/summary';
import { addDaysIso } from '../../domain/today';
import type { SessionMarker } from '../../domain/week-status';

/**
 * The lab athlete's training history, DERIVED at seed time:
 *
 * - Dates are computed from the todayIso the caller passes — never hardcoded,
 *   or the week bars/editability gating (date === today) rot within a day.
 * - Exercise and day names come from the real built-in catalog (ROUTINE), so
 *   the workout page's plan resolution finds every logged set. A renamed
 *   catalog day breaks THIS FILE at the same commit, not silently later.
 *
 * The shape of the fortnight: six training days a week (built-in split),
 * Sunday rest, one deliberately missed day three days ago so the week bars
 * show a MISSED state too, and TODAY left unlogged so the developer has a
 * fresh workout to interact with.
 */

/** The built-in split's non-empty days, in catalog order (same filter as
 *  BUILT_IN_DAYS in data/use-day-plan.ts — duplicated to keep fixtures off
 *  the data layer's import graph). */
export const LAB_SPLIT_DAYS: readonly string[] = ROUTINE_ORDER.filter(
  (d) => ROUTINE[d].length > 0
);

const dowOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** dow 0 (Sunday) = rest; Monday..Saturday walk the split in order. */
export const labScheduledWorkoutFor = (iso: string): string | null => {
  const dow = dowOf(iso);
  if (dow === 0) return null;
  return LAB_SPLIT_DAYS[(dow - 1) % LAB_SPLIT_DAYS.length] ?? null;
};

const MISSED_OFFSET = -3;
const HISTORY_DAYS = 14;

export function labWorkoutLog(todayIso: string): WorkoutRow[] {
  const rows: WorkoutRow[] = [];
  for (let offset = -HISTORY_DAYS; offset < 0; offset++) {
    if (offset === MISSED_OFFSET) continue; // the honest gap in the week bars
    const date = addDaysIso(todayIso, offset);
    const workout = labScheduledWorkoutFor(date);
    if (!workout) continue;
    const entries = ROUTINE[workout].slice(0, 3);
    entries.forEach(([exercise, plannedSets], exerciseIdx) => {
      const sets = Math.min(plannedSets, 3);
      for (let setNo = 1; setNo <= sets; setNo++) {
        rows.push({
          id: `lab-set-${date}-${exerciseIdx}-${setNo}`,
          date,
          workout,
          exercise,
          set: setNo,
          weight: 40 + exerciseIdx * 15,
          reps: 8,
          timestamp: `${date}T17:${String(exerciseIdx * 10 + setNo).padStart(2, '0')}:00`,
        });
      }
    });
  }
  return rows;
}

/** Every fully-logged past day was also FINISHED — bars read COMPLETED, and
 *  the workout page's reopen/finish states are all reachable. */
export function labSessionMarkers(todayIso: string): SessionMarker[] {
  const markers: SessionMarker[] = [];
  for (let offset = -HISTORY_DAYS; offset < 0; offset++) {
    if (offset === MISSED_OFFSET) continue;
    const date = addDaysIso(todayIso, offset);
    const workout = labScheduledWorkoutFor(date);
    if (!workout) continue;
    markers.push({ id: `lab-marker-${date}`, date, workout });
  }
  return markers;
}

export function labCardioLog(todayIso: string): CardioRow[] {
  return [-6, -2].map((offset, i) => {
    const date = addDaysIso(todayIso, offset);
    return {
      id: `lab-cardio-${i}`,
      date,
      type: 'Running',
      minutes: 25,
      distance_km: 4.2,
      timestamp: `${date}T07:30:00`,
    } as CardioRow;
  });
}

/** Weekly readings, 86 → 82 kg over twelve weeks — enough slope for charts. */
export function labBodyweightLog(
  todayIso: string
): { date: string; bodyweight: number; timestamp: string }[] {
  const out: { date: string; bodyweight: number; timestamp: string }[] = [];
  for (let week = 12; week >= 0; week--) {
    const date = addDaysIso(todayIso, -7 * week);
    out.push({ date, bodyweight: 82 + (week * 4) / 12, timestamp: `${date}T08:00:00` });
  }
  return out;
}

/** One schedule row, in force since long before the visible history. */
export function labSchedule(todayIso: string): ScheduleRow[] {
  const plan: Record<string, string> = { '0': 'Rest' };
  for (let dow = 1; dow <= 6; dow++) {
    plan[String(dow)] = LAB_SPLIT_DAYS[(dow - 1) % LAB_SPLIT_DAYS.length] ?? 'Rest';
  }
  return [{ effective_from: addDaysIso(todayIso, -84), plan, sources: null }];
}
