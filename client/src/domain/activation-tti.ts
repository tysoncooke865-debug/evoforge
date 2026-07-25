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

/* ------------------------------------------------------------------------ */
/* WHAT WAS HOLDING THE STOPWATCH                                            */
/* ------------------------------------------------------------------------ */

/**
 * WHY A SPAN WITHOUT A DEVICE IS NOT THE MEASUREMENT THAT WAS ASKED FOR.
 *
 * The work order does not say "measure the hand-off" — it says measure it "on a
 * real mid-range phone, NOT a desktop browser". `track()` (data/analytics.ts)
 * attaches nothing but the event name and the props, so without this the
 * re-measure query pools Tyson's desktop, an iPhone and the mid-range Android
 * the drop-off is actually happening on into ONE percentile. With ten athletes
 * in the cohort, one desktop row moves it — the identical argument that made
 * `isHomeHandoff` necessary, and the identical failure mode: a flattering
 * number that looks like evidence.
 *
 * COARSE ON PURPOSE. A user-agent string would answer this and would also be a
 * fingerprint; the analytics doctrine forbids it (no PII, categories not
 * values — the same reason ratings ship as `ratingBand`). These are derived
 * buckets, and the raw readings never leave the device.
 */
export type DeviceClass = 'mobile' | 'desktop' | 'unknown';
export type DeviceTier = 'low' | 'mid' | 'high' | 'unknown';

export interface DeviceInput {
  /** `matchMedia('(pointer: coarse)').matches`, or null where unavailable. */
  coarsePointer: boolean | null;
  /** `navigator.maxTouchPoints`, or null where there is no navigator. */
  maxTouchPoints: number | null;
  /**
   * `navigator.deviceMemory` in GiB — Chromium only, and already bucketed BY
   * THE SPEC to 0.25 · 0.5 · 1 · 2 · 4 · 8 (it is capped deliberately so it
   * cannot fingerprint). null everywhere else, notably iOS Safari.
   */
  memoryGb: number | null;
}

/**
 * Phone-shaped or desktop-shaped — the split the work order names.
 *
 * The media query WINS over the touch count when both are known, which is
 * deliberately NOT what `ui/core/pad-env.ts` does (it ORs them). `pointer:
 * coarse` describes the PRIMARY pointer, so a touch-screen laptop reads as the
 * desktop it is. pad-env can afford the OR because its false positive is a
 * spurious in-app keypad; here a desktop counted as a phone moves the very
 * percentile this work order is judged on.
 */
export function deviceClass({ coarsePointer, maxTouchPoints }: DeviceInput): DeviceClass {
  if (coarsePointer !== null) return coarsePointer ? 'mobile' : 'desktop';
  // No media query (older web view, or a native build): a digitiser is the only
  // signal left. Weaker, but it only ever runs where the better one is absent.
  if (maxTouchPoints !== null && Number.isFinite(maxTouchPoints)) {
    return maxTouchPoints > 0 ? 'mobile' : 'desktop';
  }
  return 'unknown';
}

/**
 * How much machine was behind the span — the "mid-range" half.
 *
 * The thresholds ARE the `deviceMemory` spec buckets, not thresholds invented
 * here: 4 GiB is the bucket a mid-range phone lands in, 8 is the cap a desktop
 * and a flagship share, ≤2 is the genuinely cheap hardware. Nothing is inferred
 * from core counts — iOS reports 4 on phones that are not remotely low-end, and
 * a tier that is confidently wrong is the nav-stall beacon again.
 *
 * So this is `unknown` on every non-Chromium browser, and that is the honest
 * answer: `device_class` still splits phone from desktop there. Refusal is not
 * loss — the same rule the spans above run on.
 */
export function deviceTier({ memoryGb }: DeviceInput): DeviceTier {
  if (memoryGb === null || !Number.isFinite(memoryGb) || memoryGb <= 0) return 'unknown';
  if (memoryGb <= 2) return 'low';
  if (memoryGb >= 8) return 'high';
  return 'mid';
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
