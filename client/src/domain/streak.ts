/**
 * Training streaks, derived from workout_log dates. Frontend-only: no schema,
 * no writes — a pure function of the rows the hooks already fetch.
 *
 * A streak counts CONSECUTIVE CALENDAR DAYS the athlete completed a session,
 * ending today or yesterday (training yesterday keeps a live streak; a gap of
 * a full day breaks it). Rest days in the ROUTINE do not pause it — the
 * number is honest about calendar consistency, which is what a streak means.
 *
 * "Completed a session" is domain/session-stats.ts and nothing else — see the
 * header there for why three separate answers to that question existed.
 */

import { completedSessions, type CompletedSessionsInput } from './session-stats';
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

export function computeStreak(
  rows: WorkoutRow[],
  todayIso: string,
  extra?: Omit<CompletedSessionsInput, 'workoutRows' | 'fromIso' | 'toIso'>
): Streak {
  // THE CANONICAL COUNT (domain/session-stats.ts). This loop used to test
  // `weight > 0 && reps > 0`, which is NOT isCountedSet: 0 kg bodyweight work
  // counts as a set everywhere else in the app, so a push-up-only athlete
  // earned XP, filled the week bars and had NO STREAK. Fixed 2026-08-06.
  const stats = completedSessions({
    workoutRows: rows,
    cardioRows: extra?.cardioRows,
    finishes: extra?.finishes,
  });
  const days = new Set<number>();
  for (const iso of stats.dates) {
    const d = toUtcDay(iso);
    if (d !== null) days.add(d);
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
