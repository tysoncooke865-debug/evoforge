import { describe, expect, it } from 'vitest';

import { DEFAULT_DROP_TIERS, type DropTier } from '../forge-drop';
import {
  chipOffers,
  choiceForLane,
  dropCapacity,
  DESKTOP_MAX_DROPS,
  DROP_CHIPS,
  flickLane,
  isQuiet,
  laneFor,
  MOBILE_MAX_DROPS,
  previewLane,
  rackBlocker,
  sessionBalance,
  sessionSummary,
  stakeFor,
  type SessionDrop,
} from '../forge-drop-session';

const T3 = DEFAULT_DROP_TIERS[2]; // CYBER FOUNDRY: min 1, max 15, lanes 5/6/7
const T1 = DEFAULT_DROP_TIERS[0]; // SCRAP RIG: max 5

const drop = (over: Partial<SessionDrop> & { key: string }): SessionDrop => ({
  stake: 5,
  lane: 6,
  phase: 'pending',
  ...over,
});

/**
 * The first argument is the SERVER's own coin_total — the live total, which
 * already contains every settled drop including the ones still falling. The
 * job of `sessionBalance` is only to hide what has not been shown yet.
 */
describe('the balance, with chips still in the air', () => {
  it('is the plain balance when nothing is falling', () => {
    const b = sessionBalance(100, []);
    expect(b).toEqual({ available: 100, reserved: 0, projected: 100, activeCount: 0 });
  });

  it('reserves a stake the instant a drop is sent, before the server answers', () => {
    const b = sessionBalance(100, [drop({ key: 'a', stake: 15 })]);
    expect(b.available).toBe(85);
    expect(b.reserved).toBe(15);
    expect(b.activeCount).toBe(1);
  });

  /**
   * The reason the whole model exists. A falling chip has ALREADY settled —
   * the payout is in the ledger — and showing it would announce the result
   * before the chip lands.
   */
  it('does not spend, or show, a win the athlete has not been shown yet', () => {
    // Started at 100, staked 10, won 40 — the server already says 130.
    const falling = drop({ key: 'a', stake: 10, phase: 'falling', payout: 40 });
    const b = sessionBalance(130, [falling]);
    expect(b.available).toBe(90); // reads exactly like a loss…
    expect(b.projected).toBe(130); // …but the win is projected
  });

  it('releases the win the moment it is revealed, without counting it twice', () => {
    // THE REGRESSION. The balance is derived from the server every render, so
    // revealing must ADD NOTHING — the coins were already in the total. The
    // first version applied the movement on top of a re-read total and drifted
    // by the drop's net, permanently.
    const revealed = drop({ key: 'a', stake: 10, phase: 'falling', payout: 40 });
    expect(sessionBalance(130, [{ ...revealed, phase: 'revealed' }])).toEqual({
      available: 130,
      reserved: 0,
      projected: 130,
      activeCount: 0,
    });
  });

  it('a settled session reads exactly the server total, however many drops it holds', () => {
    const history = [
      drop({ key: 'a', stake: 10, phase: 'revealed', payout: 26 }),
      drop({ key: 'b', stake: 5, phase: 'revealed', payout: 0 }),
      drop({ key: 'c', stake: 25, phase: 'revealed', payout: 100 }),
      drop({ key: 'd', stake: 5, phase: 'failed', error: 'no' }),
    ];
    expect(sessionBalance(861, history).available).toBe(861);
  });

  it('a refused drop takes nothing and owes nothing', () => {
    const b = sessionBalance(100, [drop({ key: 'a', stake: 15, phase: 'failed', error: 'no' })]);
    expect(b).toEqual({ available: 100, reserved: 0, projected: 100, activeCount: 0 });
  });

  /**
   * Responses arrive in whatever order the network feels like. Anchoring to a
   * quiet moment and applying every known movement on top is order-independent
   * by construction — which is what this asserts, by shuffling.
   */
  it('gives the same answer whatever order the results arrive in', () => {
    const drops: SessionDrop[] = [
      drop({ key: 'a', stake: 5, phase: 'revealed', payout: 0 }),
      drop({ key: 'b', stake: 10, phase: 'revealed', payout: 26 }),
      drop({ key: 'c', stake: 15, phase: 'falling', payout: 60 }),
      drop({ key: 'd', stake: 1, phase: 'pending' }),
    ];
    const expected = sessionBalance(200, drops);
    for (const order of [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      expect(sessionBalance(200, order.map((i) => drops[i]))).toEqual(expected);
    }
    // 200 is the live total; hide the falling chip's 60 and the pending 1.
    expect(expected.available).toBe(139);
    expect(expected.projected).toBe(199);
    expect(expected.reserved).toBe(16);
    expect(expected.activeCount).toBe(2);
  });

  it('mixed denominations and lanes all reserve independently', () => {
    const b = sessionBalance(60, [
      drop({ key: 'a', stake: 1, lane: 5 }),
      drop({ key: 'b', stake: 15, lane: 7 }),
      drop({ key: 'c', stake: 10, lane: 6 }),
    ]);
    expect(b.reserved).toBe(26);
    expect(b.available).toBe(34); // all three still pending
    expect(b.activeCount).toBe(3);
  });

  it('knows when the board is quiet enough to re-anchor', () => {
    expect(isQuiet([])).toBe(true);
    expect(isQuiet([drop({ key: 'a', phase: 'revealed' })])).toBe(true);
    expect(isQuiet([drop({ key: 'a', phase: 'failed' })])).toBe(true);
    expect(isQuiet([drop({ key: 'a', phase: 'falling' })])).toBe(false);
    expect(isQuiet([drop({ key: 'a', phase: 'pending' })])).toBe(false);
  });

  it('the summary counts only what has been revealed', () => {
    const s = sessionSummary([
      drop({ key: 'a', stake: 10, phase: 'revealed', payout: 26 }),
      drop({ key: 'b', stake: 5, phase: 'revealed', payout: 0 }),
      drop({ key: 'c', stake: 15, phase: 'falling', payout: 60 }), // not yet seen
      drop({ key: 'd', stake: 5, phase: 'failed' }),
    ]);
    expect(s).toEqual({ drops: 2, staked: 15, returned: 26, net: 11 });
  });
});

describe('capacity', () => {
  it('is three on a phone and five on a desktop', () => {
    expect(dropCapacity(320)).toBe(MOBILE_MAX_DROPS);
    expect(dropCapacity(390)).toBe(MOBILE_MAX_DROPS);
    expect(dropCapacity(767)).toBe(MOBILE_MAX_DROPS);
    expect(dropCapacity(768)).toBe(DESKTOP_MAX_DROPS);
    expect(dropCapacity(1280)).toBe(DESKTOP_MAX_DROPS);
  });

  it('counts only chips still in the air, so a landed one frees a slot', () => {
    const three = [
      drop({ key: 'a', phase: 'falling' }),
      drop({ key: 'b', phase: 'falling' }),
      drop({ key: 'c', phase: 'revealed' }),
    ];
    expect(sessionBalance(500, three).activeCount).toBe(2);
    // The revealed one freed its slot, so the board's own denominations are
    // playable again. 25 and 50 stay shut because tier 3 stops at 15 — a
    // capacity check must not be mistaken for the ceiling.
    const offers = chipOffers(T3, sessionBalance(500, three), 3);
    expect(offers.filter((c) => c.enabled).map((c) => c.value)).toEqual([1, 5, 10, 15]);
    expect(offers.find((c) => c.value === 25)!.reason).toContain('ceiling');
  });
});

describe('which chips can be played, and why the others cannot', () => {
  it('offers every denomination the board and the wallet allow', () => {
    const offers = chipOffers(T3, sessionBalance(500, []), 3);
    expect(offers.filter((o) => o.enabled).map((o) => o.value)).toEqual([1, 5, 10, 15]);
  });

  it('names the board when a chip is over its ceiling', () => {
    const offers = chipOffers(T1, sessionBalance(500, []), 3);
    const fifty = offers.find((o) => o.value === 50)!;
    expect(fifty.enabled).toBe(false);
    expect(fifty.reason).toContain('SCRAP RIG');
    expect(fifty.reason).toContain('5');
  });

  it('names the coins in play when a chip is only unaffordable because of them', () => {
    const balance = sessionBalance(20, [drop({ key: 'a', stake: 15 })]);
    const fifteen = chipOffers(T3, balance, 3).find((o) => o.value === 15)!;
    expect(fifteen.enabled).toBe(false);
    expect(fifteen.reason).toBe('5 left with 15 in play');
  });

  it('disables everything at capacity, and says so rather than blaming the wallet', () => {
    const balance = sessionBalance(500, [
      drop({ key: 'a' }), drop({ key: 'b' }), drop({ key: 'c' }),
    ]);
    const offers = chipOffers(T3, balance, 3);
    expect(offers.every((o) => !o.enabled)).toBe(true);
    expect(offers[0].reason).toBe('3 chips already falling');
    expect(rackBlocker(T3, balance, 3)).toBe('3 chips are already falling — wait for one to land');
  });

  it('the blocker is silent while anything is playable', () => {
    expect(rackBlocker(T3, sessionBalance(500, []), 3)).toBeNull();
    expect(rackBlocker(T3, sessionBalance(1, []), 3)).toBeNull(); // a 1 chip still plays
  });

  it('points at training, never at a shop, when the coins run out', () => {
    const blocked = rackBlocker(T3, sessionBalance(0, []), 3);
    expect(blocked).toContain('training');
    expect(blocked).not.toMatch(/buy|purchase|store|top ?up/i);
  });

  it('never sends a stake the board would refuse', () => {
    expect(stakeFor(15, T3, sessionBalance(500, []))).toBe(15);
    expect(stakeFor(50, T3, sessionBalance(500, []))).toBe(15); // clamped to the ceiling
    expect(stakeFor(15, T3, sessionBalance(3, []))).toBeNull(); // cannot afford any of it
    expect(stakeFor(5, T3, sessionBalance(20, [drop({ key: 'a', stake: 18 })]))).toBeNull();
  });

  it('every rack denomination is a whole number of coins', () => {
    for (const c of DROP_CHIPS) expect(c).toBe(Math.floor(c));
  });
});

describe('lanes', () => {
  it('maps the three choices onto the board own lanes', () => {
    expect(laneFor('left', T3)).toBe(5);
    expect(laneFor('centre', T3)).toBe(6);
    expect(laneFor('right', T3)).toBe(7);
  });

  it('round-trips', () => {
    for (const c of ['left', 'centre', 'right'] as const) {
      expect(choiceForLane(laneFor(c, T3), T3)).toBe(c);
    }
  });

  it('survives a board with lanes nobody expected', () => {
    const odd: DropTier = { ...T3, lanes: [2, 9] };
    expect(laneFor('left', odd)).toBe(2);
    expect(laneFor('right', odd)).toBe(9);
    expect(laneFor('centre', odd)).toBe(9);
    expect(laneFor('centre', { ...T3, lanes: [] })).toBe(0);
  });
});

describe('the flick', () => {
  const CHIP = 44;

  it('a firm upward throw launches down the centre', () => {
    expect(flickLane({ dx: 0, dy: -60, vx: 0, vy: -900 }, CHIP)).toBe('centre');
  });

  it('sideways travel picks the lane', () => {
    expect(flickLane({ dx: -40, dy: -60, vx: 0, vy: -900 }, CHIP)).toBe('left');
    expect(flickLane({ dx: 40, dy: -60, vx: 0, vy: -900 }, CHIP)).toBe('right');
  });

  it('a short sharp flick reads the same as a long slow arc', () => {
    expect(flickLane({ dx: -8, dy: -10, vx: -700, vy: -900 }, CHIP)).toBe('left');
    expect(flickLane({ dx: -60, dy: -60, vx: 0, vy: -400 }, CHIP)).toBe('left');
  });

  /**
   * THE ONE THAT PROTECTS THE WALLET. A wager must never be the default
   * outcome of touching the screen — a scroll, a nudge, a dropped thumb and a
   * sideways swipe all have to come back null so the chip returns to the rack
   * unstaked.
   */
  it('refuses to stake anything on a gesture that was not a throw', () => {
    expect(flickLane({ dx: 0, dy: 0, vx: 0, vy: 0 }, CHIP)).toBeNull(); // a tap
    expect(flickLane({ dx: 0, dy: -8, vx: 0, vy: -40 }, CHIP)).toBeNull(); // a nudge
    expect(flickLane({ dx: 90, dy: 0, vx: 800, vy: 0 }, CHIP)).toBeNull(); // a sideways swipe
    expect(flickLane({ dx: 0, dy: 200, vx: 0, vy: 900 }, CHIP)).toBeNull(); // a downward drag
    expect(flickLane({ dx: -30, dy: -20, vx: -100, vy: -100 }, CHIP)).toBeNull(); // a slow smear
  });

  it('scales with the chip, so it feels the same at any size', () => {
    const gentle = { dx: 0, dy: -30, vx: 0, vy: -100 };
    expect(flickLane(gentle, 28)).toBe('centre'); // 30 clears a small chip
    expect(flickLane(gentle, 64)).toBeNull(); // …but not a big one
  });

  it('previewing is free and always answers', () => {
    expect(previewLane(-40, CHIP)).toBe('left');
    expect(previewLane(0, CHIP)).toBe('centre');
    expect(previewLane(40, CHIP)).toBe('right');
  });
});
