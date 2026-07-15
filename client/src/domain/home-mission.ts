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

import { activityXp } from './xp';

export type MissionStatus = 'scheduled' | 'in_progress' | 'completed' | 'rest_day' | 'no_plan';

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
    return { ...base, status: input.hasSchedule ? 'rest_day' : 'no_plan' };
  }
  if (input.finished) {
    return { ...base, status: 'completed' };
  }
  // Underway: sets already banked today, or an ad-hoc was explicitly started
  // (starting one IS the commitment — the card must say RESUME, not START).
  if (input.loggedSets > 0 || (input.assignedWorkout === null && input.adhocWorkout !== null)) {
    return { ...base, status: 'in_progress' };
  }
  return { ...base, status: 'scheduled' };
}
