/**
 * Training streaks, derived from workout_log dates. Frontend-only: no schema,
 * no writes — a pure function of the rows the hooks already fetch.
 *
 * A streak counts CONSECUTIVE CALENDAR DAYS with at least one valid set,
 * ending today or yesterday (training yesterday keeps a live streak; a gap of
 * a full day breaks it). Rest days in the ROUTINE do not pause it — the
 * number is honest about calendar consistency, which is what a streak means.
 */

import { pyFloat } from './py';
import type { WorkoutRow } from './summary';

const DAY_MS = 86_400_000;

function toUtcDay(dateStr: string): number | null {
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

export interface Streak {
  /** Consecutive days ending today/yesterday; 0 = broken or never started. */
  current: number;
  /** Longest run in history. */
  best: number;
  /** True when a valid set exists today. */
  trainedToday: boolean;
}

export function computeStreak(rows: WorkoutRow[], todayIso: string): Streak {
  const days = new Set<number>();
  for (const r of rows) {
    if ((pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0) {
      const d = toUtcDay(String(r.date ?? ''));
      if (d !== null) days.add(d);
    }
  }
  const today = toUtcDay(todayIso);
  if (today === null || days.size === 0) {
    return { current: 0, best: 0, trainedToday: false };
  }

  const sorted = [...days].sort((a, b) => a - b);

  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const trainedToday = days.has(today);
  const anchor = trainedToday ? today : days.has(today - 1) ? today - 1 : null;
  if (anchor === null) {
    return { current: 0, best, trainedToday };
  }
  let current = 1;
  let cursor = anchor;
  while (days.has(cursor - 1)) {
    current += 1;
    cursor -= 1;
  }
  return { current, best, trainedToday };
}
