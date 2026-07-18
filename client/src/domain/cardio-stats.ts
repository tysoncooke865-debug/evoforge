/**
 * CARDIO_REDESIGN — the pure stats behind the conditioning dashboard. No
 * react, no supabase, no wall-clock: every function takes the rows and the
 * caller's LOCAL today (domain/today's todayIso) so early-morning sessions
 * never file under yesterday. Mirrors the Fuel streak doctrine.
 */

export interface CardioRowLike {
  date?: unknown;
  type?: unknown;
  minutes?: unknown;
  distance_km?: unknown;
  timestamp?: unknown;
}

/**
 * A suggested conditioning goal — a DEFAULT the UI shows to give the meter a
 * ceiling, NOT stored user data (the house rule: an explicit fallback, never
 * a silent fake). One place, like Fuel's DEFAULT_MACRO_TARGETS.
 */
export const DEFAULT_CARDIO_TARGETS = {
  dailyMinutes: 30,
  weeklySessions: 4,
  weeklyMinutes: 120,
} as const;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const dayOf = (row: CardioRowLike): string => {
  const d = String(row.date ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const ts = String(row.timestamp ?? '');
  return ts.slice(0, 10);
};

/** Minutes logged today, across every activity. */
export function todayMinutes(rows: readonly CardioRowLike[], today: string): number {
  let total = 0;
  for (const r of rows) if (dayOf(r) === today) total += num(r.minutes);
  return Math.round(total);
}

const shiftIso = (iso: string, deltaDays: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
};

/** Monday-of-week for an ISO date (weeks start Monday, the strip's order). */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  return shiftIso(today, -backToMonday);
}

export interface WeekDay {
  iso: string;
  /** MON..SUN */
  label: string;
  sessions: number;
  minutes: number;
  isToday: boolean;
  isFuture: boolean;
}

const DOW_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** The seven days of the current week (Mon→Sun) with per-day totals. */
export function weekStrip(rows: readonly CardioRowLike[], today: string): WeekDay[] {
  const start = weekStart(today);
  const byDay = new Map<string, { sessions: number; minutes: number }>();
  for (const r of rows) {
    const day = dayOf(r);
    const cur = byDay.get(day) ?? { sessions: 0, minutes: 0 };
    cur.sessions += 1;
    cur.minutes += num(r.minutes);
    byDay.set(day, cur);
  }
  return DOW_LABELS.map((label, i) => {
    const iso = shiftIso(start, i);
    const agg = byDay.get(iso) ?? { sessions: 0, minutes: 0 };
    return {
      iso,
      label,
      sessions: agg.sessions,
      minutes: Math.round(agg.minutes),
      isToday: iso === today,
      isFuture: iso > today,
    };
  });
}

export interface WeekTotals {
  sessions: number;
  minutes: number;
}

/** This week's session count + minutes (Mon→today inclusive). */
export function weekTotals(rows: readonly CardioRowLike[], today: string): WeekTotals {
  const start = weekStart(today);
  let sessions = 0;
  let minutes = 0;
  for (const r of rows) {
    const day = dayOf(r);
    if (day >= start && day <= today) {
      sessions += 1;
      minutes += num(r.minutes);
    }
  }
  return { sessions, minutes: Math.round(minutes) };
}

/**
 * Consecutive days with a cardio session ending at today. An unlogged TODAY
 * does not break the run — the athlete at 7am has not missed yet; the streak
 * counts back from yesterday until they log. Same rule as the Fuel streak.
 */
export function cardioStreak(rows: readonly CardioRowLike[], today: string): number {
  const set = new Set<string>();
  for (const r of rows) {
    const d = dayOf(r);
    if (d) set.add(d);
  }
  let cursor = set.has(today) ? today : shiftIso(today, -1);
  let run = 0;
  while (set.has(cursor)) {
    run += 1;
    cursor = shiftIso(cursor, -1);
  }
  return run;
}

export interface DailyMission {
  done: number;
  target: number;
  remaining: number;
  /** 0–100 for the ring/bar. */
  pct: number;
  complete: boolean;
}

/** Today's conditioning mission against the daily-minutes goal. */
export function dailyMission(minutesToday: number, targetMinutes: number): DailyMission {
  const target = targetMinutes > 0 ? targetMinutes : DEFAULT_CARDIO_TARGETS.dailyMinutes;
  const done = Math.max(0, Math.round(minutesToday));
  const remaining = Math.max(0, target - done);
  const pct = Math.min(100, Math.round((done / target) * 100));
  return { done, target, remaining, pct, complete: done >= target };
}
