/**
 * What the athlete has actually done — digested from workout_log, which is
 * already loaded for the logging screen. No new query, no new table: the Add
 * Exercise menu's "Recent", "Last: 30 kg × 8" and history-aware ranking all
 * come from rows the app has in hand.
 *
 * Pure, so the sections and the ranking can be tested without a network.
 */

import { pyFloat, pyInt } from './py';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';

export interface LastPerformance {
  weight: number;
  reps: number;
  date: string;
}

export interface ExerciseHistory {
  /** Lowercased names of everything ever logged — the ranking engine's key. */
  performed: ReadonlySet<string>;
  /** Most recently performed first, deduped. Display names. */
  recent: string[];
  /** Lowercased name → the last VALID set logged for it. */
  last: ReadonlyMap<string, LastPerformance>;
  /** Lowercased name → how many valid sets, ever. */
  counts: ReadonlyMap<string, number>;
}

const EMPTY: ExerciseHistory = {
  performed: new Set(),
  recent: [],
  last: new Map(),
  counts: new Map(),
};

/**
 * `recentLimit` bounds the Recent section (the spec asks for ~6–10). Ordering
 * is by the newest row per exercise — a set logged today beats one from March,
 * however many times March happened.
 */
export function digestHistory(rows: WorkoutRow[] | undefined, recentLimit = 10): ExerciseHistory {
  if (!rows || rows.length === 0) return EMPTY;

  const performed = new Set<string>();
  const last = new Map<string, LastPerformance>();
  const counts = new Map<string, number>();
  const newest = new Map<string, string>(); // key -> newest timestamp seen
  const display = new Map<string, string>(); // key -> the name as written

  for (const r of normaliseWorkoutLog(rows)) {
    const name = String(r.exercise ?? '').trim();
    if (name === '') continue;
    const weight = pyFloat(r.weight) ?? 0;
    const reps = pyInt(r.reps) ?? 0;
    if (weight <= 0 || reps <= 0) continue; // an invalid set is not a performance

    const key = name.toLowerCase();
    performed.add(key);
    display.set(key, name);
    counts.set(key, (counts.get(key) ?? 0) + 1);

    const stamp = String(r.timestamp ?? r.date ?? '');
    if (!newest.has(key) || stamp > (newest.get(key) as string)) {
      newest.set(key, stamp);
      last.set(key, { weight, reps, date: String(r.date ?? '') });
    }
  }

  const recent = [...newest.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, recentLimit)
    .map(([key]) => display.get(key) as string);

  return { performed, recent, last, counts };
}

/** "Last: 30 kg × 8" — or null when they have never done it. */
export function lastPerformanceLabel(history: ExerciseHistory, exercise: string): string | null {
  const p = history.last.get(exercise.toLowerCase());
  if (!p) return null;
  const w = Number.isInteger(p.weight) ? String(p.weight) : p.weight.toFixed(1);
  return `Last: ${w} kg × ${p.reps}`;
}
