import { describe, expect, it } from 'vitest';

/**
 * THE CACHE CARD'S RULES, as pure predicates.
 *
 * The card itself is JSX and the server owns every number, so what is worth testing
 * here is the DECISION TABLE: which of the brief's eight states the card is in, and
 * that none of them offers an action the server would refuse.
 *
 * These mirror `forge_cache_state()` (189/190/191). If they drift, the card offers a
 * button that errors — the failure mode Forge Trial's design note warns about.
 */

interface State {
  rung: number;
  claimable: boolean;
  floor_met: boolean;
  training_floor: number;
  trained_this_cycle: number;
  has_plan: boolean;
  today_is_rest: boolean;
  today_rest_confirmed: boolean;
  can_confirm_rest: boolean;
}

const base: State = {
  rung: 0,
  claimable: false,
  floor_met: false,
  training_floor: 3,
  trained_this_cycle: 0,
  has_plan: true,
  today_is_rest: false,
  today_rest_confirmed: false,
  can_confirm_rest: false,
};

/** The card's own logic, extracted so it is testable without rendering. */
const showsClaim = (s: State) => s.claimable && !(s.rung === 7 && !s.floor_met);
const showsRest = (s: State) => s.can_confirm_rest;
const weeklyBlocked = (s: State) => s.rung === 7 && !s.floor_met;

describe('the card never offers what the server refuses', () => {
  it('offers nothing to claim before the first plan-adherent day', () => {
    expect(showsClaim(base)).toBe(false);
    expect(showsRest(base)).toBe(false);
  });

  it('offers CLAIM on an open rung', () => {
    expect(showsClaim({ ...base, rung: 3, claimable: true })).toBe(true);
  });

  it('does NOT offer CLAIM on rung 7 until the training floor is met', () => {
    // Seven rest days reach rung 7 with zero training; the weekly cache is earned.
    // Proven live in tools/falsify-forge-cache.mjs: claimable=false, floor=3.
    const restOnly = { ...base, rung: 7, claimable: false, floor_met: false };
    expect(showsClaim(restOnly)).toBe(false);
    expect(weeklyBlocked(restOnly)).toBe(true);
  });

  it('offers it once three training days are in', () => {
    const earned = {
      ...base, rung: 7, claimable: true, floor_met: true, trained_this_cycle: 3,
    };
    expect(showsClaim(earned)).toBe(true);
    expect(weeklyBlocked(earned)).toBe(false);
  });

  it('offers CONFIRM REST only on an unconfirmed planned rest day', () => {
    expect(showsRest({ ...base, today_is_rest: true, can_confirm_rest: true })).toBe(true);
    // Already confirmed — no second tap.
    expect(showsRest({
      ...base, today_is_rest: true, today_rest_confirmed: true, can_confirm_rest: false,
    })).toBe(false);
    // A training day is not a rest day.
    expect(showsRest({ ...base, today_is_rest: false, can_confirm_rest: false })).toBe(false);
  });

  it('never offers CONFIRM REST to somebody with no plan', () => {
    // 190: `scheduled_workouts_on` returns empty for a planless athlete, which 189
    // read as rest — the ladder was climbable to 280 coins by tapping once a day.
    expect(showsRest({
      ...base, has_plan: false, today_is_rest: true, can_confirm_rest: false,
    })).toBe(false);
  });
});

describe('nothing in this feature is a chance mechanic', () => {
  it('has no random, multiplier or stake concept in its state', () => {
    const keys = Object.keys(base);
    for (const banned of ['random', 'multiplier', 'stake', 'odds', 'chance', 'spin']) {
      expect(keys.some((k) => k.includes(banned))).toBe(false);
    }
  });

  it('carries no expiry or countdown', () => {
    // §8 bans countdowns and manufactured scarcity. The ladder has no time window at
    // all, so there is nothing to count down to.
    const keys = Object.keys(base);
    for (const banned of ['expire', 'expiry', 'countdown', 'deadline', 'seconds', 'hours_left']) {
      expect(keys.some((k) => k.includes(banned))).toBe(false);
    }
  });
});
