/**
 * PROGRESSION_OVERHAUL — Weekly Momentum (spec §21): the humane
 * replacement for daily streaks. A week succeeds when valid sessions meet
 * the weekly target; rest days are irrelevant; a missed week DECAYS
 * momentum gradually (never erases it), and protective modes or a
 * recovery week bridge it entirely.
 */

export const MOMENTUM_TIERS = [
  { weeks: 52, name: 'Legendary' },
  { weeks: 26, name: 'Eternal' },
  { weeks: 12, name: 'Inferno' },
  { weeks: 6, name: 'Furnace' },
  { weeks: 3, name: 'Flame' },
  { weeks: 1, name: 'Spark' },
] as const;

export function momentumTierFor(weeks: number): string | null {
  for (const t of MOMENTUM_TIERS) if (weeks >= t.weeks) return t.name;
  return null;
}

export type WeekMode = 'normal' | 'recovery' | 'injury' | 'illness' | 'travel' | 'taper' | 'deload';

export interface WeekOutcome {
  /** Monday-start ISO date of the week. */
  weekStart: string;
  targetSessions: number;
  completedSessions: number;
  mode: WeekMode;
  recoveryWeekUsed: boolean;
}

export interface MomentumState {
  current: number;
  peak: number;
  lifetimeSuccessfulWeeks: number;
  tier: string | null;
  /** How the LAST processed week resolved. */
  lastWeekStatus: 'success' | 'bridged' | 'decayed' | 'none';
}

/** Failed weeks cost this many momentum weeks — decay, not erasure. */
export const DECAY_PER_MISSED_WEEK = 2;

export function computeMomentum(weeks: WeekOutcome[]): MomentumState {
  let current = 0;
  let peak = 0;
  let lifetime = 0;
  let last: MomentumState['lastWeekStatus'] = 'none';

  const ordered = [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  for (const w of ordered) {
    const protectedWeek = w.mode !== 'normal' || w.recoveryWeekUsed;
    if (w.targetSessions > 0 && w.completedSessions >= w.targetSessions) {
      current += 1;
      lifetime += 1;
      last = 'success';
    } else if (protectedWeek) {
      last = 'bridged'; // holds, neither grows nor decays
    } else {
      current = Math.max(0, current - DECAY_PER_MISSED_WEEK);
      last = 'decayed';
    }
    peak = Math.max(peak, current);
  }

  return { current, peak, lifetimeSuccessfulWeeks: lifetime, tier: momentumTierFor(current), lastWeekStatus: last };
}

/** Monday of the week containing `iso` (UTC parse of local-day strings —
 *  the app-wide convention). */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Derive week outcomes from raw history: distinct trained days per week
 * vs the target. `trainedDays` = ISO dates with at least one valid set —
 * the same predicate the streak and summary use.
 */
export function weeksFromHistory(
  trainedDays: string[],
  targetSessions: number,
  todayIso: string,
  windowWeeks = 78
): WeekOutcome[] {
  if (trainedDays.length === 0) return [];
  const byWeek = new Map<string, Set<string>>();
  for (const day of trainedDays) {
    const ws = weekStartOf(day);
    const set = byWeek.get(ws) ?? new Set<string>();
    set.add(day.slice(0, 10));
    byWeek.set(ws, set);
  }
  const thisWeek = weekStartOf(todayIso);
  const firstWeek = [...byWeek.keys()].sort()[0];
  const out: WeekOutcome[] = [];
  const cursor = new Date(`${firstWeek}T00:00:00Z`);
  for (let i = 0; i < windowWeeks * 2; i++) {
    const ws = cursor.toISOString().slice(0, 10);
    if (ws >= thisWeek) break; // the current week is still in play — never judged early
    out.push({
      weekStart: ws,
      targetSessions,
      completedSessions: byWeek.get(ws)?.size ?? 0,
      mode: 'normal',
      recoveryWeekUsed: false,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out.slice(-windowWeeks);
}
