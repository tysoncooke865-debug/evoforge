/**
 * NAV STALL — the decision half of the nav-freeze beacon (data/version-guard.ts).
 *
 * WHY THIS IS NOW A PURE FUNCTION. The beacon shipped 2026-07-18 to hunt an iOS
 * PWA freeze: a 250 ms heartbeat that reports any gap ≥ 700 ms near a
 * navigation. It has since written ~1,250 rows and taught nobody anything,
 * because it was measuring the wrong thing:
 *
 *   700–899 ms  12.8%
 *   900–1099 ms 74.5%   <-- browsers clamp timers to 1/second when hidden
 *   1100–1999   10.2%
 *   2000–4999    0.6%   <-- the only bucket that is plausibly real jank
 *   5000+        1.8%   <-- fully suspended tab, hours long
 *
 * Three quarters of every "freeze" this app has ever recorded is a backgrounded
 * tab's throttled timer, and the p50 on EVERY route is ~1001 ms — real jank
 * would differ by route. So the rule below refuses to report any gap that
 * overlapped a hidden document, and holds the floor above the 1-second clamp so
 * a partially-throttled tick cannot masquerade as a stall either.
 *
 * The point is not tidiness: performance is the leading remaining hypothesis
 * for why athletes stop after onboarding, and this is the only instrument the
 * app has for it. An instrument that reports noise is worse than none, because
 * it looks like evidence.
 */

/** Below this, a "gap" is indistinguishable from a throttled timer tick. */
export const NAV_STALL_FLOOR_MS = 1500;

/** Above this, nothing was blocking a thread — the tab was asleep. */
export const NAV_STALL_CEILING_MS = 15_000;

export interface StallInput {
  /** Measured gap between heartbeats. */
  gapMs: number;
  /** Is the document hidden right now? */
  hidden: boolean;
  /** Did the document become hidden at any point since the last heartbeat? */
  wasHiddenSinceLastBeat: boolean;
  /** Reports already sent this session. */
  sent: number;
  /** How long the beacon has been running. */
  elapsedMs: number;
}

export const NAV_STALL_MAX_REPORTS = 3;
export const NAV_STALL_MAX_RUNTIME_MS = 10 * 60 * 1000;

/** True once the beacon should stop running entirely. */
export function navBeaconExhausted(sent: number, elapsedMs: number): boolean {
  return sent >= NAV_STALL_MAX_REPORTS || elapsedMs > NAV_STALL_MAX_RUNTIME_MS;
}

/**
 * Should this gap be reported as a real main-thread stall?
 *
 * Deliberately conservative: a missed real stall costs one data point, while a
 * false one poisons the only signal we have — and 74.5% of the historical data
 * is exactly that false positive.
 */
export function shouldReportStall(input: StallInput): boolean {
  if (navBeaconExhausted(input.sent, input.elapsedMs)) return false;
  // A hidden document cannot stall a user who is not looking at it, and its
  // timers are throttled anyway.
  if (input.hidden || input.wasHiddenSinceLastBeat) return false;
  if (input.gapMs < NAV_STALL_FLOOR_MS) return false;
  if (input.gapMs > NAV_STALL_CEILING_MS) return false;
  return true;
}
