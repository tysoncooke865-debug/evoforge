/**
 * WHAT DAY IS IT? — the athlete's answer, not the server's.
 *
 * THE BUG (Tyson, 2026-07-14): the app derived "today" with
 * `new Date().toISOString().slice(0, 10)`, which is the UTC date. East of
 * Greenwich that is WRONG for part of every day: at 8am on a Tuesday in
 * Sydney (UTC+10) the UTC date is still Monday, so Train showed Monday as
 * today and marked Tuesday's Pull session UPCOMING — while the athlete stood
 * in the gym on Tuesday, holding their phone, looking at a calendar that
 * disagreed with the app.
 *
 * Worse, the same UTC date was written to workout_log.date, so an early-morning
 * session was FILED UNDER YESTERDAY.
 *
 * A workout happens on the day the athlete says it happened. `todayIso()`
 * therefore reads the LOCAL calendar — the same one their phone's clock app
 * shows.
 *
 * A stored `YYYY-MM-DD` is still parsed at UTC midnight everywhere (dowOf,
 * addDays, the streak, the schedule): that is a pure calendar calculation and
 * has no timezone in it. The bug was only ever in deriving TODAY from a wall
 * clock. Do not "fix" the parsers to match; they are already right.
 */

/** The athlete's calendar date, YYYY-MM-DD. */
export function todayIso(): string {
  return localIso(new Date());
}

/** Any Date, as the LOCAL calendar's YYYY-MM-DD (never shifted by timezone). */
export function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * NOTE ON TIMESTAMPS — deliberately NOT changed to local.
 *
 * `workout_log.timestamp` and `xp_events.created_at` stay UTC
 * (`toISOString()`). created_at is a timestamptz, and Postgres reads a naive
 * string as UTC: handing it a local wall clock would file every XP grant hours
 * in the future and break the ledger's date arithmetic (the coin guard, the
 * drift check).
 *
 * Only the CALENDAR DATE is local — because a calendar date is what an athlete
 * means by "today", and a timestamp is an instant. They are different things
 * and only one of them was wrong.
 */

/** ISO date + n days (UTC arithmetic on the calendar string — no wall
 *  clock, no timezone drift). D6 (2026-07-19): was written inline three
 *  times (today.tsx, progress-aggregates, scheduled-streak). */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
