/**
 * TRANSFORM P6: the aggregates behind Progress — period totals and the
 * per-day series the charts plot. Pure over rows, like summary.ts: the
 * hooks feed rows in, so vitest can hammer these without a network.
 *
 * DATES follow the app-wide convention (toISOString().slice(0,10) = UTC),
 * the same one workout_log.date is written from and the streak reads.
 *
 * XP is NEVER recomputed here — activityXp() from the golden-pinned xp.ts
 * is the only place XP is minted, and a period's XP is that function over
 * the period's sets and cardio minutes.
 */

import { pyFloat } from './py';
import { normaliseWorkoutLog, type CardioRow, type WorkoutRow } from './summary';
import { estimated1rm } from './workouts';
import { activityXp } from './xp';

export interface PeriodTotals {
  /** Distinct dates with at least one valid set. */
  sessions: number;
  sets: number;
  reps: number;
  /** Σ weight × reps over valid sets, kg. */
  volumeKg: number;
  cardioMinutes: number;
  /** activityXp() over this period's sets + cardio minutes. */
  xp: number;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dow = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** The Monday of todayIso's week (UTC), matching weeklyContract's window. */
export function weekStart(todayIso: string): string {
  return addDays(todayIso, -((dow(todayIso) + 6) % 7));
}

/** Totals over [fromIso, toIso] inclusive. Invalid sets (weight or reps
 *  at or below zero) never count — the same rule the streak and summary use. */
export function periodTotals(
  workoutRows: WorkoutRow[],
  cardioRows: CardioRow[],
  fromIso: string,
  toIso: string
): PeriodTotals {
  const rows = normaliseWorkoutLog(workoutRows).filter((r) => {
    const d = String(r.date ?? '');
    return d >= fromIso && d <= toIso;
  });

  const dates = new Set<string>();
  let sets = 0;
  let reps = 0;
  let volumeKg = 0;
  for (const r of rows) {
    const w = pyFloat(r.weight) ?? 0;
    const rp = pyFloat(r.reps) ?? 0;
    if (r.weight == null || w < 0 || rp <= 0) continue; // 061: bodyweight sets count
    sets += 1;
    reps += Math.trunc(rp);
    volumeKg += w * rp;
    dates.add(String(r.date ?? ''));
  }

  let cardioMinutes = 0;
  for (const c of cardioRows) {
    const d = String(c.date ?? '');
    if (d < fromIso || d > toIso) continue;
    cardioMinutes += pyFloat(c.minutes) ?? 0;
  }

  return {
    sessions: dates.size,
    sets,
    reps,
    volumeKg,
    cardioMinutes,
    xp: activityXp(sets, cardioMinutes),
  };
}

export const TIMEFRAMES = [
  { key: '4W', days: 28 },
  { key: '12W', days: 84 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: null },
] as const;

export type TimeframeKey = (typeof TIMEFRAMES)[number]['key'];

/** The inclusive start date of a timeframe, or null for ALL (no floor). */
export function timeframeStart(key: TimeframeKey, todayIso: string): string | null {
  const tf = TIMEFRAMES.find((t) => t.key === key);
  if (!tf || tf.days === null) return null;
  return addDays(todayIso, -(tf.days - 1));
}

export const METRICS = ['E1RM', 'VOLUME', 'SETS'] as const;
export type MetricKey = (typeof METRICS)[number];

export interface DayPoint {
  date: string;
  value: number;
}

/**
 * One point per training day for an exercise: best e1RM, total volume, or
 * set count. Ascending by date. `from` null means no floor (ALL).
 */
export function exerciseSeries(
  workoutRows: WorkoutRow[],
  exercise: string,
  metric: MetricKey,
  from: string | null,
  toIso: string
): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const r of normaliseWorkoutLog(workoutRows)) {
    if (String(r.exercise ?? '') !== exercise) continue;
    const date = String(r.date ?? '');
    if (date > toIso) continue;
    if (from !== null && date < from) continue;
    const w = pyFloat(r.weight) ?? 0;
    const reps = pyFloat(r.reps) ?? 0;
    // Charts are LIFT metrics — a 0 kg set has no e1RM and no load to
    // plot, so weight > 0 stays ON PURPOSE here (061 changes counting,
    // not lift math).
    if (w <= 0 || reps <= 0) continue;

    const prev = byDay.get(date) ?? 0;
    if (metric === 'E1RM') {
      byDay.set(date, Math.max(prev, estimated1rm(w, Math.trunc(reps))));
    } else if (metric === 'VOLUME') {
      byDay.set(date, prev + w * reps);
    } else {
      byDay.set(date, prev + 1);
    }
  }
  return [...byDay.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
