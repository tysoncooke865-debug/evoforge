/**
 * HOME_REDESIGN — today's mission, as one pure decision.
 *
 * The Home mission card and the Train hub must never disagree about what
 * today holds, so this function takes the SAME ingredients the hub already
 * computes (sourceDayFor's assigned day, the session-store ad-hoc, the
 * finish marker, the hub's done/target rule) and only decides what state
 * the card is in. No network, no clock — the screen feeds today in.
 *
 * THE REWARD IS REAL: `xpReward` is activityXp() over the plan's sets — the
 * exact XP the ledger grants at 10/set — never a marketing number. Ad-hoc
 * workouts have no plan target, so their reward is unknown-until-earned and
 * renders as banked XP only.
 */

import { sessionStatus } from './session-status';
import { activityXp } from './xp';

export type MissionStatus =
  | 'scheduled'
  | 'in_progress'
  /**
   * Every planned set logged, FINISH not yet pressed (2026-08-11).
   *
   * This state did not exist, so 17 of 17 sets read exactly like 1 of 17 and
   * the card offered RESUME MISSION to somebody who had finished every set.
   * The audit caught it beside "17/17 SETS COMPLETED", which is the card
   * disagreeing with its own button.
   */
  | 'ready_to_finish'
  | 'completed'
  /** Never trained, and today is not a scheduled day — a first session is
   *  still offered. You cannot be on a rest day before you have trained. */
  | 'first_workout'
  | 'rest_day'
  | 'no_plan';

export interface MissionInput {
  /** Any schedule rows exist at all. */
  hasSchedule: boolean;
  /** sourceDayFor(todayIso) — the plan's name for today, null on rest/none. */
  assignedWorkout: string | null;
  /** The active ad-hoc workout's name (session store), null when none. */
  adhocWorkout: string | null;
  /** A finish marker exists for (today, workout) — or FINISH was pressed. */
  finished: boolean;
  /** The hub's setsFor rule: plan sets completed (clamped per entry). */
  doneSets: number;
  /** The plan's total sets for the day (0 for ad-hoc). */
  targetSets: number;
  /** ALL valid sets logged today for this workout — XP was granted per set
   *  whether or not the plan asked for it, so banked XP counts them all. */
  loggedSets: number;
  /** Day one of the athlete's own plan, offered when nothing is scheduled
   *  and they have never trained. Null when they have no plan at all. */
  starterWorkout: string | null;
  /** Has any workout ever been COMPLETED? */
  hasEverTrained: boolean;
  /** The persisted record (138): the first workout has been OPENED. True
   *  with zero logged sets, which is exactly what `loggedSets` cannot see. */
  firstWorkoutStarted: boolean;
}

export interface Mission {
  status: MissionStatus;
  /** The workout the CTA opens — null only for rest_day / no_plan. */
  workout: string | null;
  doneSets: number;
  targetSets: number;
  /** activityXp over the plan's sets — the real grant for finishing the plan. */
  xpReward: number;
  /** activityXp over sets actually logged today — already granted. */
  xpBanked: number;
}

export function deriveMission(input: MissionInput): Mission {
  const workout = input.assignedWorkout ?? input.adhocWorkout;
  const xpReward = activityXp(input.targetSets, 0);
  const xpBanked = activityXp(input.loggedSets, 0);
  const base = {
    workout,
    doneSets: input.doneSets,
    targetSets: input.targetSets,
    xpReward,
    xpBanked,
  };

  if (workout === null) {
    // A REST DAY IS EARNED. Before the first completed workout there is
    // nothing to recover from, and "RECOVERY DAY" was the last thing a
    // brand-new athlete saw after being promised a first workout — with a
    // TRAIN ANYWAY button that only changed tabs. Offer day one of their
    // plan instead, and let the card say so.
    if (!input.hasEverTrained && input.starterWorkout !== null) {
      // ALREADY OPENED IT? Then this is a session to RESUME, not to start.
      // `in_progress` already renders exactly that card, so the state the
      // athlete is in gets the words it deserves without a new one.
      return {
        ...base,
        workout: input.starterWorkout,
        status: input.firstWorkoutStarted ? 'in_progress' : 'first_workout',
      };
    }
    return { ...base, status: input.hasSchedule ? 'rest_day' : 'no_plan' };
  }
  /**
   * THE CANONICAL STATUS DECIDES (domain/session-status.ts), so Home, Train
   * and the workout page cannot describe one session three ways. `finished`
   * is checked inside it, first and before any set arithmetic — a completed
   * workout can never report as in progress, which is exactly what the audit
   * found it doing.
   */
  const canonical = sessionStatus({
    workout,
    targetSets: input.targetSets,
    doneSets: input.doneSets,
    finished: input.finished,
    // An ad-hoc session is under way the moment it is started: starting one
    // IS the commitment, and it can have zero logged sets.
    opened:
      input.loggedSets > 0 || (input.assignedWorkout === null && input.adhocWorkout !== null),
  });
  if (canonical === 'completed') return { ...base, status: 'completed' };
  if (canonical === 'ready_to_finish') return { ...base, status: 'ready_to_finish' };
  if (canonical === 'in_progress') return { ...base, status: 'in_progress' };
  return { ...base, status: 'scheduled' };
}
