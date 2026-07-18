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
import { displayWeight, type WeightUnit } from './units';

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
    if (r.weight == null || weight < 0 || reps <= 0) continue; // 061: 0 kg counts; no-reps never

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
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .slice(0, recentLimit)
    .map(([key]) => display.get(key) as string);

  return { performed, recent, last, counts };
}

/** "Last: 30 kg × 8" (or "Last: 66.1 lb × 8") — null when never done.
 *  `p.weight` is kg from the log; `unit` is the athlete's per-exercise lens. */
export function lastPerformanceLabel(
  history: ExerciseHistory,
  exercise: string,
  unit: WeightUnit = 'kg'
): string | null {
  const p = history.last.get(exercise.toLowerCase());
  if (!p) return null;
  // 061: a 0 kg set is bodyweight work — "BW × 12" reads honest, "0 kg × 12"
  // reads like a data error.
  if (p.weight === 0) return `Last: BW × ${p.reps}`;
  return `Last: ${displayWeight(p.weight, unit)} ${unit} × ${p.reps}`;
}
