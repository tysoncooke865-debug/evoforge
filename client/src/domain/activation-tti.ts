/**
 * ACTIVATION TIME-TO-INTERACTIVE — the honesty rules for a measured span
 * (docs/ACTIVATION_ANALYTICS.md).
 *
 * WHY THIS EXISTS. The activation funnel (domain/activation-funnel.ts) says how
 * FAR an athlete got. It cannot say how long they waited to get there, and the
 * leading hypothesis for the post-onboarding drop-off is that they waited too
 * long. The closest thing the rail has today is `ms_since_prev_step`, which
 * conflates two unrelated quantities: how long the APP took, and how long the
 * HUMAN thought about it. An athlete who reads Home for forty seconds and one
 * whose Home spun for forty seconds are the same row.
 *
 * WHY IT IS NOT JUST `now - startedAt`. The nav-freeze beacon was exactly that
 * subtraction, wrote ~1,250 rows, and taught nobody anything (domain/nav-stall.ts):
 * three quarters of every "freeze" it ever reported was a backgrounded tab's
 * throttled timer, and its p50 was ~1001 ms on EVERY route — which real jank
 * never is. A wall-clock span that crossed a hidden document measures the
 * athlete's phone call, not this app. The rules below REFUSE those spans rather
 * than averaging them in, because that beacon is also why the perf hypothesis
 * this work order tests has no trustworthy evidence behind it yet: every
 * `pwa_nav_diag` row it produced before 2026-07-25 is unusable.
 *
 * REFUSAL IS NOT LOSS. A refused span reports `null` — the athlete is still
 * counted by the step ladder, which is the census; this is only the stopwatch.
 *
 * `null` VS `0`. The funnel's rule is "unknown is null, never 0", because a 0
 * silently drags an average down. That is about UNKNOWN. A genuinely instant
 * span IS 0 here (a warm cache really did settle within the same millisecond)
 * and is reported as 0 — the two must not be conflated in the other direction
 * either, or every fast device reads as a missing measurement.
 */

/**
 * Above this, the span is not describing an interaction any more.
 *
 * The work order's own window is the first 60 seconds after onboarding: past
 * it, an athlete has stopped waiting by any definition, and a span of hours is
 * certainly a suspended tab that never fired `pagehide` (iOS PWAs do this — the
 * reason nav-stall listens to three separate events and still ceilings). The
 * long tail is not lost with the span: the funnel already shows those athletes
 * as "reached step N and stopped", which is the question they answer.
 */
export const TTI_CEILING_MS = 60_000;

export interface SpanInput {
  /** When the span was stamped (epoch ms), or null if it never was. */
  startedAt: number | null;
  /** Now (epoch ms). */
  now: number;
  /** Did the document go hidden at ANY point inside the span? */
  hiddenDuringSpan: boolean;
}

/**
 * Does the tap that ends onboarding hand the athlete straight to HOME?
 *
 * The two Home spans (`ms_to_mount`, `ms_home_to_interactive`) start at that tap
 * rather than at a component mount on purpose: the profile refetch
 * `onboarding.tsx` must await before it can navigate is part of what the athlete
 * sits through, and starting later would be measuring our own convenience.
 *
 * BUT ONBOARDING DOES NOT ALWAYS HAND OFF TO HOME. Act I's step 6 offers BUILD
 * MY OWN and SCAN MY PLAN, and those athletes were promised the routine builder
 * — so `home_reached` fires whenever they eventually reach Home, which is
 * however many minutes of building a plan later. A span stamped for them files
 * HUMAN DECISION TIME under the very prop that exists because
 * `ms_since_prev_step` already conflates the two, and it does it silently: a
 * builder who finished in forty seconds is indistinguishable from a Home that
 * spun for forty. With a cohort of ten, one such row moves the percentile.
 *
 * So the span is stamped only when Home is the destination. Everybody else
 * reports `null` — unknown, which is true, and which the re-measure query's
 * `count(prop)` column surfaces instead of burying.
 */
export function isHomeHandoff(destination: string): boolean {
  // Query and hash are navigation detail, not destination — '/routine?import=1'
  // is the builder, and stripping both means a later '/?from=onboarding' still
  // reads as Home rather than quietly turning the stopwatch off. Then an
  // EXPLICIT '/' only: an empty or unrecognised destination refuses, for the
  // same reason every rule below refuses.
  return destination.replace(/[?#].*$/, '') === '/';
}

/**
 * The measured span in ms, or null when it cannot be trusted.
 *
 * Deliberately conservative, for the nav-stall reason: a missed real span costs
 * one data point, a false one poisons the only performance signal the app has.
 */
export function interactiveSpanMs(input: SpanInput): number | null {
  const { startedAt, now, hiddenDuringSpan } = input;
  // Never stamped — a cold boot, a deep link, or a build that predates the
  // stamp. Unknown, not instant.
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(now)) return null;
  // The 2026-07-25 lesson: a hidden document's clock measures backgrounding.
  if (hiddenDuringSpan) return null;
  const ms = now - startedAt;
  // Device clocks move backwards (manual changes, NTP). Not evidence.
  if (ms < 0) return null;
  if (ms > TTI_CEILING_MS) return null;
  return ms;
}
