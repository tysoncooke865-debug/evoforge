/**
 * ORIGIN ONBOARDING — the first mission (spec: ORIGIN_ONBOARDING_SPEC.md §6).
 *
 * No mission tables exist and Home's mission card derives purely from real
 * schedule/plan/log rows ("a system without a backend is hidden, never
 * mocked"). The first origin mission is therefore REAL DATA: when a new
 * athlete skipped the TRAINING split step, binding seeds the origin's
 * recommended split with the schedule ROTATED so today is training day 1
 * (the preset spreads start Monday — a Sunday signup used to land on Rest).
 */

import { SPLITS, scheduleForDays } from '../exercise-library';
import type { OriginId } from './types';

/** Origin → recommended split (spec §6). */
export const ORIGIN_SPLITS: Record<OriginId, string> = {
  titan: 'ppl3',
  mass: 'ppl3',
  cardio: 'fb3',
  shredder: 'fb3',
  aesthetic: 'ppl3',
};

export function originSplitFor(origin: OriginId): string {
  return ORIGIN_SPLITS[origin];
}

/**
 * The weekly schedule for `splitKey`, rotated so `todayDow` (getUTCDay)
 * trains the split's day 1, preserving the split's rest-day spacing.
 * Same jsonb shape as defaultScheduleFor/scheduleForDays: keys '0'..'6',
 * values a day name or 'Rest'. Null when the split is unknown/dayless.
 */
export function rotateScheduleToToday(splitKey: string, todayDow: number): Record<string, string> | null {
  const split = SPLITS.find((s) => s.key === splitKey);
  if (!split || split.days.length === 0) return null;
  const base = scheduleForDays(split.days);
  if (!base) return null;
  let firstTrainingDow = -1;
  for (let d = 0; d <= 6; d += 1) {
    if (base[String(d)] !== 'Rest') { firstTrainingDow = d; break; }
  }
  if (firstTrainingDow < 0) return null;
  const dow = ((Math.trunc(todayDow) % 7) + 7) % 7;
  const offset = (dow - firstTrainingDow + 7) % 7;
  const plan: Record<string, string> = {};
  for (let d = 0; d <= 6; d += 1) {
    plan[String((d + offset) % 7)] = base[String(d)];
  }
  return plan;
}
