import type { EffectiveEntry } from './session-plan';

/**
 * FORGE TRIAL — what may carry a pledge, on the client (Spec v5 §4).
 *
 * THE SERVER IS THE AUTHORITY. Migration 163 enforces all of this in a BEFORE
 * trigger on `workout_callouts`, and nothing here can loosen it. This exists so the
 * SCREEN agrees with the server, because a Golden Dot that offers a pledge
 * settlement then refuses is worse than no Golden Dot at all — it teaches an
 * athlete that the app is unreliable, and it does it at the exact moment they were
 * about to commit coins.
 *
 * §4: "Targets may only come from the day's planned workout and programmed
 * progression… enforced by UI (pick from plan, no free entry) and server validation."
 *
 * WHAT THE CLIENT CAN DECIDE, AND WHAT IT CANNOT.
 *
 * It can decide plan membership, because `buildEffectivePlan` already computes it:
 * `added` marks an athlete-added exercise and `skipped` marks one they dropped
 * today. Neither is programmed work.
 *
 * It CANNOT decide whether a load is above program — that needs the athlete's whole
 * logging history, which the server has and the client does not. So the Dot appears
 * for a planned exercise and the TARGET is validated when the tray commits. That
 * split is deliberate and is why `forge_trial_allowance` returns a message: the
 * refusal has to be sayable, not just enforceable.
 */

export type TrialIneligibility =
  | 'ad-hoc'
  | 'skipped'
  | 'rest-day'
  | 'finished';

export interface TrialEligibility {
  eligible: boolean;
  /** Why not, when not. Null when the Dot should appear. */
  reason: TrialIneligibility | null;
}

/**
 * May this exercise carry a Golden Dot right now?
 *
 * `restDay` comes from the schedule, not from "the plan is empty" — an athlete can
 * have an empty plan on a training day, and that is a plan problem rather than a
 * rest day. The server draws the same distinction (`scheduled_workout_on` returns
 * null only for a day the plan names 'Rest').
 */
export function trialEligibility(
  entry: Pick<EffectiveEntry, 'added' | 'skipped' | 'target'>,
  opts: { restDay: boolean; setsDone: number }
): TrialEligibility {
  // A rest day is the physiotherapist test at its most literal: nothing on a day
  // the plan says to rest may be worth coins.
  if (opts.restDay) return { eligible: false, reason: 'rest-day' };

  // An athlete-added exercise is not programmed work. This is the single most
  // important client-side check, because it is the one the server cannot make:
  // it has no copy of the built-in split's exercise list.
  if (entry.added) return { eligible: false, reason: 'ad-hoc' };

  if (entry.skipped || entry.target <= 0) return { eligible: false, reason: 'skipped' };

  // Nothing left to pledge on. An exercise you have finished has no upcoming set.
  if (opts.setsDone >= entry.target) return { eligible: false, reason: 'finished' };

  return { eligible: true, reason: null };
}

/** Why the Dot is absent, for a screen reader or a hint. Never scolding, and never
 *  an invitation to make the exercise eligible — that would be soliciting. */
export function ineligibilityNote(reason: TrialIneligibility): string {
  switch (reason) {
    case 'rest-day':
      return 'Rest day — trials are for planned training.';
    case 'ad-hoc':
      return 'Trials are for exercises in your plan.';
    case 'skipped':
      return 'This exercise is skipped today.';
    case 'finished':
      return 'Every set here is done.';
  }
}
