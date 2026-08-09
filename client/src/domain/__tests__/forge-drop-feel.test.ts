import { describe, expect, it } from 'vitest';

import { DEFAULT_DROP_TIERS } from '../forge-drop';
import {
  celebrationFor,
  FX_BUDGET,
  landingStagger,
  outcomeTier,
  SLOWMO_FROM,
  strikeIntensity,
  tension,
  timeScale,
  topMultiplier,
  type OutcomeTier,
} from '../forge-drop-feel';

const T1 = DEFAULT_DROP_TIERS[0]; // SCRAP RIG: max stake 5, top multiplier 3
const T3 = DEFAULT_DROP_TIERS[2]; // CYBER FOUNDRY: max stake 15, top multiplier 4

describe('how big an outcome is allowed to feel', () => {
  it('reads the ceiling off the board rather than assuming one', () => {
    expect(topMultiplier(T1)).toBe(3);
    expect(topMultiplier(T3)).toBe(4);
    for (const t of DEFAULT_DROP_TIERS) {
      expect(topMultiplier(t) * t.max_stake).toBe(t.max_payout);
    }
  });

  it('grades an outcome by what the ledger actually paid', () => {
    expect(outcomeTier(10, 0, 0.7, T3)).toBe('loss');
    expect(outcomeTier(10, 7, 0.7, T3)).toBe('loss');
    expect(outcomeTier(10, 10, 1, T3)).toBe('even');
    expect(outcomeTier(10, 12, 1.26, T3)).toBe('win');
    expect(outcomeTier(10, 20, 2, T3)).toBe('big');
    expect(outcomeTier(10, 40, 4, T3)).toBe('jackpot');
  });

  it('the ceiling is a jackpot on every board, at every stake', () => {
    for (const t of DEFAULT_DROP_TIERS) {
      const top = topMultiplier(t);
      for (const stake of [t.min_stake, t.max_stake]) {
        expect(outcomeTier(stake, Math.round(stake * top), top, t)).toBe('jackpot');
      }
    }
  });

  /**
   * THE ONE THAT MATTERS. A loss that lands beside the big multiplier is a
   * loss. `outcomeTier` has no near-miss to return, so no view can render one
   * — this asserts the vocabulary itself, not a policy somebody has to follow.
   */
  it('has no near-miss to express, whatever the slot next door paid', () => {
    const tiers = new Set<OutcomeTier>();
    for (const m of T3.multipliers) tiers.add(outcomeTier(10, Math.floor(10 * m), m, T3));
    // Every slot on this board grades as one of four honest outcomes. There is
    // no fifth, and no argument a view could make for one. ('big' is absent
    // here because CYBER FOUNDRY jumps 1.45x -> 4x with nothing between, so its
    // only doubling outcome IS the ceiling.)
    expect(tiers).toEqual(new Set(['loss', 'even', 'win', 'jackpot']));
    // The slot immediately inside the rim pays 1.45x — a win, and only a win,
    // however close to the 4x it landed.
    expect(outcomeTier(10, 14, 1.45, T3)).toBe('win');
    // And 'big' is reachable on a board that has a doubling slot below its rim.
    expect(outcomeTier(10, 20, 2, T3)).toBe('big');
  });

  it('never celebrates a loss, and never punishes one', () => {
    const loss = celebrationFor('loss');
    expect(loss.dim).toBe(false);
    expect(loss.tone).toBe('text-dim');
    expect(loss.callout).toBe('BELOW STAKE');
    // Most losing slots pay something back, so the wording must not claim
    // otherwise while the card beside it counts out the coins.
    expect(/no return|nothing/i.test(loss.callout)).toBe(false);
    // It still lands: silence would read as a dropped frame.
    expect(loss.rings).toBeGreaterThan(0);
    expect(loss.shake).toBeGreaterThan(0);
    expect(/again|unlucky|so close|nearly|bad luck/i.test(loss.callout)).toBe(false);
  });

  it('escalates monotonically, and only the ceiling interrupts the interface', () => {
    const order: OutcomeTier[] = ['loss', 'even', 'win', 'big', 'jackpot'];
    const cs = order.map(celebrationFor);
    for (let i = 1; i < cs.length; i += 1) {
      expect(cs[i].rings, order[i]).toBeGreaterThanOrEqual(cs[i - 1].rings);
      expect(cs[i].sparks, order[i]).toBeGreaterThanOrEqual(cs[i - 1].sparks);
      expect(cs[i].shake, order[i]).toBeGreaterThanOrEqual(cs[i - 1].shake);
    }
    expect(cs.filter((c) => c.dim)).toHaveLength(1);
    expect(celebrationFor('jackpot').dim).toBe(true);
  });

  it('no single celebration can exceed the spark budget', () => {
    for (const t of ['loss', 'even', 'win', 'big', 'jackpot'] as OutcomeTier[]) {
      expect(celebrationFor(t).sparks).toBeLessThanOrEqual(FX_BUDGET.sparks);
    }
  });

  it('holds the headline long enough to read and short enough to replay', () => {
    for (const t of ['loss', 'even', 'win', 'big', 'jackpot'] as OutcomeTier[]) {
      const { holdMs } = celebrationFor(t);
      expect(holdMs).toBeGreaterThanOrEqual(500);
      expect(holdMs).toBeLessThanOrEqual(1500);
    }
  });
});

describe('keeping several chips apart', () => {
  it('a bigger stake strikes brighter, normalised to its own board', () => {
    expect(strikeIntensity(1, T3)).toBeLessThan(strikeIntensity(15, T3));
    // The quietest chip on a big board is not dimmer than the loudest on a
    // small one — intensity is a share of the ceiling, not an absolute.
    expect(strikeIntensity(5, T1)).toBeCloseTo(strikeIntensity(15, T3), 5);
  });

  it('never goes fully dark, so the smallest legal stake is still visible', () => {
    for (const t of DEFAULT_DROP_TIERS) {
      expect(strikeIntensity(t.min_stake, t)).toBeGreaterThan(0.4);
      expect(strikeIntensity(t.max_stake, t)).toBeLessThanOrEqual(1);
    }
    expect(strikeIntensity(0, T3)).toBeGreaterThan(0.4);
    expect(strikeIntensity(9999, T3)).toBeLessThanOrEqual(1);
  });

  it('staggers landings into a cascade, and caps the wait', () => {
    expect(landingStagger(0)).toBe(0);
    expect(landingStagger(1)).toBeGreaterThan(0);
    expect(landingStagger(4)).toBeGreaterThan(landingStagger(3));
    // A sixth chip does not wait longer than the fifth.
    expect(landingStagger(9)).toBe(landingStagger(4));
    expect(landingStagger(9)).toBeLessThan(0.5);
  });
});

describe('the descent', () => {
  it('builds toward the slot rather than sitting flat', () => {
    expect(tension(0, 12)).toBe(0);
    expect(tension(12, 12)).toBe(1);
    // Eased: most of the change belongs to the last rows, where the tension is.
    expect(tension(6, 12)).toBeLessThan(0.25);
    expect(tension(11, 12)).toBeGreaterThan(0.7);
  });

  it('is monotonic and clamped outside the board', () => {
    let prev = -1;
    for (let y = 0; y <= 12; y += 0.5) {
      const t = tension(y, 12);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(tension(-5, 12)).toBe(0);
    expect(tension(99, 12)).toBe(1);
  });

  /**
   * Time is only ever SLOWED, and only near the end. A scale above 1 anywhere
   * would mean the replay outran the fall it is replaying.
   */
  it('slows only near the landing, and never speeds anything up', () => {
    expect(timeScale(0, false)).toBe(1);
    expect(timeScale(0.5, false)).toBe(1);
    expect(timeScale(SLOWMO_FROM - 0.01, false)).toBe(1);
    expect(timeScale(0.93, false)).toBeLessThan(1);
    expect(timeScale(1, false)).toBe(1);
    for (let p = 0; p <= 1.001; p += 0.01) {
      const s = timeScale(p, false);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThan(0.4); // never a stall
    }
  });

  it('reduced motion gets no slow-motion at all', () => {
    for (let p = 0; p <= 1.001; p += 0.05) expect(timeScale(p, true)).toBe(1);
  });
});

describe('the effect budget', () => {
  it('is finite everywhere, so effects cannot accumulate', () => {
    for (const [name, n] of Object.entries(FX_BUDGET)) {
      expect(Number.isFinite(n), name).toBe(true);
      expect(n, name).toBeGreaterThan(0);
      expect(n, name).toBeLessThanOrEqual(30);
    }
  });
});
