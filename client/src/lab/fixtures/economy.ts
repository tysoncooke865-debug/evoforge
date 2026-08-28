// Relative runtime imports on purpose: the vitest suite loads these fixtures
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).
import { DEFAULT_REVEAL_TABLE, REVEAL_WEIGHT_TOTAL } from '../../domain/forge-reveal';
import { addDaysIso } from '../../domain/today';

import { LAB_COIN_TOTAL } from './athlete';
import { labScheduledWorkoutFor } from './training';

/**
 * THE COIN-ECONOMY SURFACES on Home: the daily forge cache, the recovery run,
 * the reveal chip, the pool-invite chip.
 *
 * These four read through RPCs, and until 2026-08-28 none of them was seeded —
 * so in the lab their queryFn escaped to the real network, RLS answered empty,
 * and Home rendered with the DAILY FORGE CACHE card missing entirely. A design
 * lab comparing an incomplete page is comparing the wrong page.
 *
 * TWO RULES held throughout, and they decide every value below:
 *
 * 1. DERIVE, NEVER HARDCODE. The cache state is computed from the SAME
 *    schedule the training fixtures use, at seed time. Today is a rest day six
 *    days out of seven at the fixture's own choosing, and a hardcoded state
 *    would contradict the week bars every Sunday.
 *
 * 2. NEVER SEED A STATE WHOSE ONLY AFFORDANCE IS AN UN-SHIMMED WRITE. CLAIM
 *    (useClaimForgeCache), CONFIRM REST DAY (useConfirmRestDay), the recovery
 *    claim and the reveal claim are all real mutations — nothing in
 *    lab/mock/mutations.ts intercepts them. So the seeded athlete is one whose
 *    day is honestly settled: today is unlogged, so nothing is claimable yet.
 *    A variant that wants to design the CLAIM state shims the mutation first.
 */

/** The ladder is seven rungs; the server's own cycle length. */
const CYCLE_DAYS = 7;

/** Training days a cycle needs before the weekly (rung 7) cache opens. */
const TRAINING_FLOOR = 3;

/** The fixture's one deliberately missed day, mirrored from training.ts — a
 *  cycle that counted it as adherent would disagree with the week bars. */
const MISSED_OFFSET = -3;

/**
 * Where the lab athlete stands on the cache ladder, derived from the schedule.
 *
 * The cycle is the seven days ending today. A past day is ADHERENT if the plan
 * called for training and the fixture logged it, or the plan called for rest.
 * TODAY is deliberately excluded from the earned count: the training fixture
 * leaves it unlogged so the developer has a fresh workout to interact with, so
 * nothing has been earned for it yet and `claimable` is false.
 */
export function labForgeCacheState(todayIso: string) {
  let adherent = 0;
  let trained = 0;
  for (let offset = -(CYCLE_DAYS - 1); offset < 0; offset++) {
    const date = addDaysIso(todayIso, offset);
    const planned = labScheduledWorkoutFor(date);
    if (planned === null) {
      adherent += 1; // a planned rest day counts, and nothing expires
      continue;
    }
    if (offset === MISSED_OFFSET) continue; // the honest gap
    adherent += 1;
    trained += 1;
  }

  const todayPlan = labScheduledWorkoutFor(todayIso);
  const todayIsRest = todayPlan === null;
  const rung = Math.min(CYCLE_DAYS, adherent);

  return {
    cycle: 1,
    rung,
    coins: 40,
    label: 'Tempered',
    // Today is unlogged (training.ts leaves it so), so today's rung is not
    // earned. `rung > 0 && !claimable` is the card's DONE state: it reads
    // "DAY n COMPLETE / Next: day n+1", and offers no button the lab would
    // send to the real backend.
    claimable: false,
    trained_this_cycle: trained,
    adherent_this_cycle: adherent,
    training_floor: TRAINING_FLOOR,
    floor_met: trained >= TRAINING_FLOOR,
    training_day: todayPlan,
    today_is_rest: todayIsRest,
    // On a rest day this must be TRUE, or the card offers CONFIRM REST DAY —
    // an un-shimmed write (rule 2). A settled rest day is also the honest
    // reading of an athlete who has kept the plan all cycle.
    today_rest_confirmed: todayIsRest,
    today_plan: todayPlan,
    next_coins: 60,
    next_label: 'Fine steel',
    message: todayIsRest
      ? 'Rest is part of the plan. The ladder holds.'
      : 'Log a set today to open the next rung.',
  };
}

/**
 * The recovery run is a FLOOR, not a reward: below five coins, three
 * legitimate sets pay a fixed 50 so nobody is locked out of the economy.
 *
 * The lab athlete holds LAB_COIN_TOTAL (145), so it is correctly NOT armed and
 * the card's recovery block does not render. That is the accurate state, not a
 * gap — seeding it armed would both contradict the wallet and put an
 * un-shimmed CLAIM on screen.
 */
export const LAB_RECOVERY_RUN = {
  balance: LAB_COIN_TOTAL,
  eligible: false,
  armed: false,
  sets_done: 0,
  sets_needed: 3,
  coins: 50,
  message: 'Your balance is healthy — the recovery run is not needed.',
};

/**
 * Reveals: none banked. They are produced by finishing a workout or setting a
 * PR, and a diligent athlete has claimed what they earned — so `banked: []`
 * renders the chip's own empty answer (it returns null rather than an empty
 * state) and keeps the un-shimmed claim off screen.
 *
 * The table comes from the SHIPPED constant, not a copy: §3 requires the odds
 * on screen to be the odds the server is offering, and a fixture that drifted
 * from DEFAULT_REVEAL_TABLE would show a lab designer numbers nobody offers.
 */
export const LAB_REVEAL_STATE = {
  banked: [],
  table: DEFAULT_REVEAL_TABLE,
  tableTotal: REVEAL_WEIGHT_TOTAL,
  balance: LAB_COIN_TOTAL,
};

/** Pool invitations: empty is the overwhelmingly common answer, and the chip
 *  renders null for it — "an invitation nobody sent is not news". */
export const LAB_POOL_INVITATIONS: readonly [] = [];

/** `app_flag_enabled('evolution_path_beta')`. TRUE because LAB_ORIGIN puts the
 *  athlete on the aesthetic path at stage 2 with migration_status 'complete' —
 *  a false flag would gate off the path UI for an athlete who is demonstrably
 *  walking it. (`progressionFeatures.evolutionPathEnabled` is the other gate
 *  and is already true, so the feature is live for everyone who has it.) */
export const LAB_EVOLUTION_PATH_BETA = true;

/**
 * THE EVOLUTION PATH, and the lesson of seeding a flag: turning
 * `evolution_path_beta` on ENABLED `useOriginPathState`, whose own key was
 * then unseeded — so Home's PathSummary went straight back to the network.
 * Seeding one key can arm the next one; measure again after every fixture.
 *
 * Consistent with LAB_ORIGIN by construction (aesthetic, stage 2 → level 2).
 * `thisWeek` is derived so the week never drifts out of date, and every
 * unlocked reward is already CLAIMED — an unclaimed one is a claim button,
 * and the claim is not shimmed.
 */
export function labOriginPathState(todayIso: string) {
  return {
    ok: true,
    hasPath: true,
    originPathId: 'aesthetic' as const,
    status: 'active' as const,
    currentLevel: 2 as const,
    activeChapter: 2 as const,
    activeWeek: 7,
    qualifiedWeeks: 6,
    // Mon–Sat, matching labSchedule's six training days (Sunday rest).
    selectedTrainingDays: [1, 2, 3, 4, 5, 6],
    startedAt: `${addDaysIso(todayIso, -44)}T08:00:00Z`,
    firstWorkoutCompletedAt: `${addDaysIso(todayIso, -43)}T18:20:00Z`,
    thisWeek: {
      weekStart: addDaysIso(todayIso, -(((new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7))),
      plannedSessions: 6,
      requiredSessions: 4,
      // The fixture logs every planned day this cycle except the one missed
      // three days ago; the same arithmetic the cache ladder does.
      completedSessions: 4,
      qualifiedAt: null,
    },
    nextReward: {
      rewardId: 'aesthetic-w8-title',
      kind: 'title' as const,
      label: 'THE SCULPTOR',
      description: 'Awarded for eight qualified weeks on the aesthetic path.',
      weekIndex: 8,
    },
    unlockedRewards: [
      {
        rewardId: 'aesthetic-w4-portrait',
        kind: 'portrait' as const,
        label: 'TEMPERED FRAME',
        weekIndex: 4,
        unlockedAt: `${addDaysIso(todayIso, -20)}T09:00:00Z`,
        claimedAt: `${addDaysIso(todayIso, -20)}T09:04:00Z`,
      },
    ],
  };
}
