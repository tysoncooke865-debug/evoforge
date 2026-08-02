/**
 * THE PROGRESSION MATH — pure, deterministic, and mirrored in SQL.
 *
 * `migrations/131_origin_evolution_path_rpcs.sql` runs the authoritative
 * copy (origin_week_required / origin_level_for_weeks /
 * origin_chapter_for_weeks). These functions exist so the UI can render a
 * requirement BEFORE the server has seen the workout, and so the rules are
 * unit-testable without a database. `__tests__/qualification.test.ts` pins
 * the shared worked examples from the brief.
 *
 * If you change a rule here, change the SQL in the same commit. The tests
 * check the examples; only a human checks the pair.
 */

import type { ChapterId, OriginLevel, WeekKind } from './types';

export const DEFAULT_QUALIFICATION = {
  ratio: 0.75,
  reliefSessions: 1,
  floor: 1,
  defaultPlannedSessions: 3,
} as const;

/**
 * Sessions needed to qualify a week.
 *
 * ~75% of the plan, rounded UP. The brief's two worked examples fall out of
 * that exactly: a 3-session plan needs 3 (ceil 2.25), a 4-session plan needs
 * 3 (ceil 3.0). Deload and injury-adjusted weeks drop one session but never
 * below one — a week with no training in it is not a training week.
 */
export function requiredSessions(
  plannedSessions: number,
  kind: WeekKind = 'standard',
  rules = DEFAULT_QUALIFICATION
): number {
  const planned = Number.isFinite(plannedSessions) ? Math.trunc(plannedSessions) : 0;
  if (planned <= 0) return rules.floor;
  const base = Math.ceil(planned * rules.ratio);
  const relieved = kind === 'standard' ? base : base - rules.reliefSessions;
  return Math.max(rules.floor, relieved);
}

/**
 * Qualified weeks -> Origin Level, given whether the path has awakened.
 *
 * Awakening is NOT a week threshold: Level 1 is the first saved qualifying
 * workout, because "train once, see yourself change" is the product's whole
 * opening promise. Weeks only start mattering from Level 2.
 */
export function levelForWeeks(qualifiedWeeks: number, awakened: boolean): OriginLevel {
  if (!awakened) return 0;
  const w = Math.max(0, Math.trunc(qualifiedWeeks || 0));
  if (w >= 48) return 4;
  if (w >= 26) return 3;
  if (w >= 12) return 2;
  return 1;
}

/** Qualified weeks -> the chapter now in progress. */
export function chapterForWeeks(qualifiedWeeks: number): ChapterId {
  const w = Math.max(0, Math.trunc(qualifiedWeeks || 0));
  if (w >= 48) return 4;
  if (w >= 26) return 3;
  if (w >= 12) return 2;
  return 1;
}

/** Which chapter a given 1-48 path week belongs to. */
export function chapterOfWeek(weekIndex: number): ChapterId {
  const w = Math.max(1, Math.trunc(weekIndex || 1));
  if (w > 48) return 4;
  if (w > 26) return 3;
  if (w > 12) return 2;
  return 1;
}

/** Qualified weeks still needed for the next level. Null at Level 4. */
export function weeksToNextLevel(qualifiedWeeks: number): number | null {
  const w = Math.max(0, Math.trunc(qualifiedWeeks || 0));
  for (const gate of [12, 26, 48]) if (w < gate) return gate - w;
  return null;
}

/**
 * The Monday of a date's week, as an ISO date string.
 *
 * Monday-start matches `date_trunc('week', ...)` in Postgres and the app's
 * existing `weekStart` in progress-aggregates. Parsed as UTC so a device in
 * any timezone agrees with the server about which week a date belongs to —
 * the alternative is an athlete whose Sunday session lands in two different
 * weeks depending on where they opened the app.
 */
export function weekStartIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const backToMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - backToMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Sessions planned for a week from the athlete's committed training days.
 * Falls back to the default rather than zero: an athlete who skipped the
 * commitment step still has a real, achievable requirement.
 */
export function plannedSessionsFor(
  selectedTrainingDays: readonly number[] | null | undefined,
  rules = DEFAULT_QUALIFICATION
): number {
  const n = selectedTrainingDays?.length ?? 0;
  return n > 0 ? n : rules.defaultPlannedSessions;
}

/** Progress toward the current week's requirement, 0..1. */
export function weekProgress(completed: number, required: number): number {
  if (required <= 0) return 0;
  return Math.max(0, Math.min(1, completed / required));
}
