/**
 * ACTIVATION FUNNEL (docs/ACTIVATION_ANALYTICS.md) — the ordered ladder from
 * "onboarding finished" to "first set logged".
 *
 * WHY THIS EXISTS. The origin program instrumented onboarding thoroughly
 * (docs/ORIGIN_ANALYTICS.md) and it ends at `onboarding_completed`. Everything
 * after that was dark, and that is exactly where athletes are lost: of the ten
 * who signed up after the Origin flow launched (2026-07-17), ten made a
 * profile, eight bound an origin — and three logged a set.
 *
 * WHAT THIS ADDS OVER `page_view`. Two things page_view structurally cannot say:
 *   1. page_view records the PREVIOUS route on navigation, so an athlete who
 *      lands on Home and quits without navigating emits NOTHING. That is
 *      precisely the population we are trying to see.
 *   2. It records that a route was visited, never what was ON it. `train_opened`
 *      carries the state the athlete FOUND — a plan or no plan, a workout or a
 *      rest day. That is the difference between "they didn't want to train" and
 *      "there was nothing to tap", which no existing event can distinguish.
 *
 * SHAPE. One event name, `activation_step`, carrying an ordered `index` — so the
 * funnel is `max(index) per user` in SQL rather than the hand-written
 * route-name query this replaces.
 *
 * BOUNDED BY CONSTRUCTION. Each step emits at most once per athlete, and the
 * ladder switches itself OFF PERMANENTLY once the first set lands: four rows per
 * athlete, lifetime. This rail cannot flood analytics_events the way an
 * unthrottled retry loop did on 2026-07-21.
 *
 * Duplicates are harmless anyway: the funnel query reads `max(index)` and
 * `min(created_at) per (user, step)`, both idempotent. The local mark is a
 * write-volume optimisation, NOT a correctness mechanism — which is what lets it
 * be cleared on sign-out with the rest of the caches, no exception carved out.
 */

export const ACTIVATION_EVENT = 'activation_step';

/** The ladder, in order. `index` is the 1-based position in THIS array. */
export const ACTIVATION_STEPS = [
  'home_reached',
  'train_opened',
  'workout_opened',
  'first_set_logged',
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

/** step -> epoch ms it was first reached. Persisted per athlete. */
export type ActivationMarks = Partial<Record<ActivationStep, number>>;

export function activationStepIndex(step: ActivationStep): number {
  return ACTIVATION_STEPS.indexOf(step) + 1;
}

/** The terminal step is the whole point of the funnel: once it lands, stop. */
export function isActivationComplete(marks: ActivationMarks): boolean {
  return typeof marks.first_set_logged === 'number';
}

export function shouldEmitActivationStep(marks: ActivationMarks, step: ActivationStep): boolean {
  if (isActivationComplete(marks)) return false;
  return typeof marks[step] !== 'number';
}

/**
 * The most recent step we have already seen — the baseline for
 * `ms_since_prev_step`. Deliberately the LATEST mark rather than the
 * next-lowest index: an athlete can deep-link straight into a workout, and
 * "time since we last saw them do anything" stays meaningful when they do.
 */
export function previousMarkAt(marks: ActivationMarks): number | null {
  const times: number[] = [];
  for (const step of ACTIVATION_STEPS) {
    const at = marks[step];
    if (typeof at === 'number' && Number.isFinite(at)) times.push(at);
  }
  return times.length > 0 ? Math.max(...times) : null;
}

/**
 * A non-negative elapsed time, or null. Device clocks move backwards (manual
 * changes, NTP corrections); a negative duration is not evidence of anything, so
 * it is recorded as "unknown" rather than as a number that would poison an avg.
 */
function elapsed(from: number | null, to: number): number | null {
  if (from == null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const ms = to - from;
  return ms >= 0 ? ms : null;
}

/**
 * The props every activation event carries. `extra` is the per-step state the
 * athlete found — counts and enums only, never PII (the analytics.ts contract).
 */
export function activationStepProps(
  step: ActivationStep,
  marks: ActivationMarks,
  opts: { now: number; signupAtMs: number | null; extra?: Record<string, unknown> }
): Record<string, unknown> {
  return {
    step,
    index: activationStepIndex(step),
    ms_since_signup: elapsed(opts.signupAtMs, opts.now),
    ms_since_prev_step: elapsed(previousMarkAt(marks), opts.now),
    ...(opts.extra ?? {}),
  };
}

/** Parse a persisted mark blob, tolerating anything a older/newer build wrote. */
export function parseActivationMarks(raw: string | null): ActivationMarks {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ActivationMarks = {};
    for (const step of ACTIVATION_STEPS) {
      const at = (parsed as Record<string, unknown>)[step];
      if (typeof at === 'number' && Number.isFinite(at) && at > 0) out[step] = at;
    }
    return out;
  } catch {
    return {};
  }
}
