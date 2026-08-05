/**
 * REFORGE DAY — every 28 days, and it completes without photos
 * (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * NAMING, BECAUSE THIS REPO ALREADY HAD A "REFORGE". The one-off Origin
 * re-choice unlocked by three valid workouts keeps its mechanics and is
 * called the **Origin Reforge** in copy. **Reforge Day** is this: the
 * periodic ceremony where the last 28 days are reviewed, physique
 * calibration is OFFERED, the rating is recalculated and the movement is
 * revealed.
 *
 * WHY 28 AND NOT 14. Front, side and back physique photos are emotionally
 * and logistically demanding. Asking twice a month spends the ceremony's
 * meaning and, for anyone uncomfortable being photographed, converts a
 * feature into a fortnightly reminder that they are declining something.
 * Monthly also makes the comparison worth looking at, because 28 days is
 * roughly the shortest window in which a physique change is visible at all.
 *
 * WHAT THIS IS NOT. It is not the weekly Evo Review. That stays weekly and
 * is not touched: momentum decays per missed WEEK, the in-flight week is
 * never judged, and `next_review_at` is +7 days. The review is the engine;
 * Reforge Day is the event the athlete experiences. Between the two, nothing
 * freezes — strength, PRs, XP and consistency all keep moving.
 *
 * Pure: dates in, a cadence out.
 */

export const REFORGE_CYCLE_DAYS = 28;

export interface ReforgeCadenceInput {
  /** ISO date the cycle is anchored to — the first COMPLETED workout. */
  anchorIso: string | null;
  /** ISO timestamp of the last completed Reforge Day, if any. */
  lastReforgeIso: string | null;
  todayIso: string;
}

export interface ReforgeCadence {
  /** No anchor yet: the athlete has not trained, so no cycle has started. */
  started: boolean;
  /** A full cycle has elapsed and has not been reforged. */
  due: boolean;
  /** Days into the current cycle, 0-27. */
  dayOfCycle: number;
  /** Days remaining until the next Reforge Day (0 when due). */
  daysUntil: number;
  /** Which Reforge this would be — 1 for the first. */
  cycleNumber: number;
  /** The window the ceremony reviews: [fromIso, todayIso]. */
  fromIso: string | null;
  /** True on the first ever Reforge, which explains itself differently. */
  isFirst: boolean;
}

const DAY = 86_400_000;

/** Whole days between two ISO dates, UTC-anchored like the rest of the app. */
function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / DAY);
}

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(base + days * DAY).toISOString().slice(0, 10);
}

export function reforgeCadence(input: ReforgeCadenceInput): ReforgeCadence {
  const idle: ReforgeCadence = {
    started: false,
    due: false,
    dayOfCycle: 0,
    daysUntil: REFORGE_CYCLE_DAYS,
    cycleNumber: 1,
    fromIso: null,
    isFirst: true,
  };
  if (!input.anchorIso) return idle;

  const sinceAnchor = daysBetweenIso(input.anchorIso, input.todayIso);
  if (sinceAnchor === null || sinceAnchor < 0) return idle;

  // The cycle runs from the last Reforge, or from the anchor when there has
  // never been one. A clock that restarted from "today" every visit would
  // never come due; a clock measured only from the anchor would come due
  // again the day after a Reforge.
  const from = input.lastReforgeIso ?? input.anchorIso;
  const sinceFrom = daysBetweenIso(from, input.todayIso);
  if (sinceFrom === null || sinceFrom < 0) return { ...idle, started: true };

  const due = sinceFrom >= REFORGE_CYCLE_DAYS;
  const dayOfCycle = due ? REFORGE_CYCLE_DAYS : sinceFrom;
  const completed = input.lastReforgeIso
    ? Math.max(1, Math.floor((daysBetweenIso(input.anchorIso, input.lastReforgeIso) ?? 0) / REFORGE_CYCLE_DAYS))
    : 0;

  return {
    started: true,
    due,
    dayOfCycle,
    daysUntil: due ? 0 : REFORGE_CYCLE_DAYS - sinceFrom,
    cycleNumber: completed + 1,
    // The window is the LAST 28 days, never a partial one: a Reforge run
    // late still reviews a full cycle rather than however long it was left.
    fromIso: due ? addDaysIso(input.todayIso, -REFORGE_CYCLE_DAYS) : from,
    isFirst: input.lastReforgeIso === null,
  };
}

/**
 * What the ceremony says about the physique half, given whether a fresh
 * calibration happened. Both branches complete — the reveal is never held
 * behind an upload.
 */
export function reforgeOutcomeCopy(opts: {
  withPhotos: boolean;
  hasBaseline: boolean;
}): { title: string; body: string } {
  if (opts.withPhotos) {
    return {
      title: 'REFORGE COMPLETE',
      body: opts.hasBaseline
        ? 'Your training, performance and physique calibration have all been updated.'
        : 'Your private baseline is set. Your next Reforge can show visual change.',
    };
  }
  return {
    title: 'REFORGE COMPLETE',
    body: 'Your training and performance data have been updated. Your physique calibration was not refreshed.',
  };
}
