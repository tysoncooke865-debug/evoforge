/**
 * "+0.4 EVO" — THE HONEST VERSION (2026-08-03, third brief).
 *
 * Tyson has asked three times for the mission card to show an estimated Evo
 * gain, and twice the answer was "that number cannot exist". It still cannot
 * exist the way the mock implies — as a PROMISE the system will honour — for
 * the reason written out in `session-evidence.ts`: the rating is recomputed
 * from the whole evidence base at review time through a weighted geometric
 * mean with tier gates, so one session's contribution is path-dependent and
 * unknowable before the sets are logged.
 *
 * But that only rules out a FORECAST. It does not rule out a MEASUREMENT, and
 * a measurement is what an athlete actually wants when they read "+0.4 EVO":
 * *what has training been worth to me lately?*
 *
 * So this computes the athlete's OWN recent rate:
 *
 *     (rating now − rating at the start of the window) ÷ training days in it
 *
 * Both terms are real rows — `evo_rating_snapshots` and the workout log. The
 * number is personal (a beginner's is large, a plateaued athlete's is small),
 * it moves when their training moves, and it can be checked against their own
 * history. It is labelled as an estimate everywhere it appears because it is
 * an average of the past, not a guarantee about the next hour.
 *
 * IT REFUSES TO GUESS. Null — and the UI shows no Evo number at all — when:
 *   · fewer than two snapshots fall in the window (nothing to subtract),
 *   · the rating did not go UP (a flat or falling rate is not a reward, and
 *     "+0.0 EVO" on a CTA is a demotivator, not honesty),
 *   · fewer than MIN_SESSIONS training days back the average (below that a
 *     single lucky review dominates and the number is noise wearing a
 *     decimal point).
 * A new athlete therefore sees the pillar benefit only, until they have
 * earned a rate of their own. That is the whole difference between an
 * estimate and a fabrication.
 */

export interface EvoRateSnapshot {
  /** The snapshot's displayed (integer) rating. */
  displayedRating: number;
  /** ISO timestamp the review was calculated at. */
  atIso: string;
}

export interface EvoPerSession {
  /** Evo per training day, rounded to one decimal; never below 0.1. */
  perSession: number;
  /** Training days the average is built from. */
  sessions: number;
  /** Whole Evo points gained across the window. */
  gain: number;
  /** Days the window actually spans (for the caption). */
  windowDays: number;
}

/** Below this the average is one review's noise, not a rate. */
export const MIN_SESSIONS = 4;
/** Long enough to contain several reviews, short enough to be "lately". */
export const DEFAULT_WINDOW_DAYS = 120;

const DAY_MS = 86_400_000;

export function estimateEvoPerSession(input: {
  /** The live displayed rating. */
  currentRating: number;
  /** Snapshots in any order; only `calculated_at` inside the window count. */
  snapshots: readonly EvoRateSnapshot[];
  /** ISO calendar dates (YYYY-MM-DD) on which counted sets were logged.
   *  Duplicates are tolerated — the function counts DISTINCT days. */
  trainingDates: readonly string[];
  /** The athlete's local calendar day (domain/today.ts). */
  todayIso: string;
  windowDays?: number;
}): EvoPerSession | null {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const todayMs = Date.parse(`${input.todayIso}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return null;
  const cutoffMs = todayMs - windowDays * DAY_MS;

  const current = Number(input.currentRating);
  if (!Number.isFinite(current)) return null;

  // The OLDEST snapshot still inside the window is the baseline.
  let baseline: number | null = null;
  let baselineMs = Number.POSITIVE_INFINITY;
  let inWindow = 0;
  for (const s of input.snapshots) {
    const t = Date.parse(String(s.atIso));
    const r = Number(s.displayedRating);
    if (!Number.isFinite(t) || !Number.isFinite(r) || t < cutoffMs || t > todayMs + DAY_MS) continue;
    inWindow += 1;
    if (t < baselineMs) {
      baselineMs = t;
      baseline = r;
    }
  }
  if (baseline === null || inWindow < 2) return null;

  const gain = current - baseline;
  if (gain <= 0) return null;

  // DISTINCT training days inside the same window. Days, not sets: the rate is
  // "per time you trained", which is the unit the mission card is priced in.
  const days = new Set<string>();
  for (const d of input.trainingDates) {
    const t = Date.parse(`${String(d)}T00:00:00Z`);
    if (!Number.isFinite(t) || t < cutoffMs || t > todayMs) continue;
    days.add(String(d));
  }
  const sessions = days.size;
  if (sessions < MIN_SESSIONS) return null;

  // One decimal, and never rounded away to nothing: an athlete who genuinely
  // gained is never told their training was worth 0.0.
  const raw = gain / sessions;
  const perSession = Math.max(0.1, Math.round(raw * 10) / 10);

  return {
    perSession,
    sessions,
    gain,
    windowDays: Math.max(1, Math.round((todayMs - baselineMs) / DAY_MS)),
  };
}

/** "+0.4" — the pill's number, formatted once so every surface agrees. */
export function formatEvoEstimate(perSession: number): string {
  return `+${perSession.toFixed(1)}`;
}
