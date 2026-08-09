import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REVEAL_TABLE,
  REVEAL_WEIGHT_TOTAL,
  bankedLabel,
  formatChance,
  formatRevealCoins,
  pickForDisplay,
  producerLabel,
  revealChance,
  revealEv,
  validateRevealTable,
} from '../forge-reveal';

describe('the reveal can only ever add (v5 invariant 1)', () => {
  it('every outcome pays a positive whole number of coins', () => {
    for (const o of DEFAULT_REVEAL_TABLE) {
      expect(o.coins, o.label).toBeGreaterThan(0);
      expect(Number.isInteger(o.coins), o.label).toBe(true);
    }
    // There is no zero and no loss, which is the entire difference between this
    // and the board it replaces.
    expect(DEFAULT_REVEAL_TABLE.some((o) => o.coins <= 0)).toBe(false);
  });

  it('the shipped table passes its own validator', () => {
    expect(validateRevealTable()).toEqual([]);
  });

  it('the table is §3s published one, exactly', () => {
    expect(DEFAULT_REVEAL_TABLE.map((o) => o.coins)).toEqual([20, 28, 40, 60, 150]);
    expect(DEFAULT_REVEAL_TABLE.map((o) => o.weight)).toEqual([450, 300, 150, 80, 20]);
    expect(DEFAULT_REVEAL_TABLE.reduce((s, o) => s + o.weight, 0)).toBe(REVEAL_WEIGHT_TOTAL);
  });

  /**
   * §2 lists the reveal at "~36 coins average" while the §3 table it publishes
   * averages 31.20. The TABLE is what a player is shown, so the table wins and the
   * number is pinned here — if a retune moves it, this says so by name rather than
   * letting a tolerance absorb it.
   */
  it('averages 31.20 coins — pinned, because two sections of the spec disagree', () => {
    expect(Number(revealEv().toFixed(2))).toBe(31.2);
    // …and stays inside what §3 intends: a bonus, never a fortune.
    expect(revealEv()).toBeGreaterThan(25);
    expect(revealEv()).toBeLessThan(40);
  });

  it('the top outcome is smaller than a training day', () => {
    // §3: "ceiling one workout's base income, never a fortune". A full day is
    // about 200 coins under the v5 economy.
    expect(Math.max(...DEFAULT_REVEAL_TABLE.map((o) => o.coins))).toBeLessThan(200);
  });

  /**
   * THE FALLBACK AND THE DATABASE MUST AGREE. `forge_reveal_table` is the
   * authority; this file is a first-paint mirror. A table retuned in SQL without
   * touching the client would otherwise publish odds the server is not offering —
   * so the migration is parsed and compared rather than trusted.
   */
  it('the shipped fallback matches what migration 161 seeds', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../migrations/161_forge_reveal.sql'),
      'utf8'
    );
    const rows = [...sql.matchAll(/\(1,\s*(\d+),\s*(\d+),\s*'([^']+)'\)/g)].map((m) => ({
      coins: Number(m[1]),
      weight: Number(m[2]),
      label: m[3],
    }));
    expect(rows.length, 'the migration seed was not found — did the INSERT change shape?')
      .toBe(DEFAULT_REVEAL_TABLE.length);
    expect(rows).toEqual(DEFAULT_REVEAL_TABLE);
  });

  it('the validator CATCHES a table that could lose, or mislead', () => {
    const said = (t: typeof DEFAULT_REVEAL_TABLE) =>
      validateRevealTable(t).map((p) => p.problem).join(' | ');

    // A losing outcome — invariant 1.
    expect(said([{ coins: 0, weight: 1000, label: 'Nothing' }]))
      .toMatch(/must always add/);
    expect(said([{ coins: -20, weight: 1000, label: 'Slag' }]))
      .toMatch(/must always add/);
    // An unreachable outcome dressed as a prize.
    expect(said([
      { coins: 20, weight: 999, label: 'A steady pour' },
      { coins: 150, weight: 1, label: 'Masterwork' },
    ])).toMatch(/decorative, not reachable/);
    // Weights that do not form a distribution.
    expect(said([{ coins: 20, weight: 5, label: 'A steady pour' }]))
      .toMatch(/weights sum to 5 per-mille/);
    // A jackpot-sized ceiling.
    expect(said([
      { coins: 20, weight: 900, label: 'A steady pour' },
      { coins: 5000, weight: 100, label: 'Fortune' },
    ])).toMatch(/more than a full training day/);
    // Fractional coins — §2 wants whole, legible numbers.
    expect(said([{ coins: 20.5, weight: 1000, label: 'A steady pour' }]))
      .toMatch(/not a whole number/);
    // …and the real table trips none of them.
    expect(said(DEFAULT_REVEAL_TABLE)).toBe('');
  });
});

describe('the published table reads honestly', () => {
  it('chances are the real ones and sum to certainty', () => {
    const total = DEFAULT_REVEAL_TABLE.reduce((s, o) => s + revealChance(o), 0);
    expect(total).toBeCloseTo(1, 10);
    expect(formatChance(revealChance(DEFAULT_REVEAL_TABLE[0]))).toBe('45%');
    expect(formatChance(revealChance(DEFAULT_REVEAL_TABLE[4]))).toBe('2%');
  });

  it('a sub-1% chance is never rounded up to 1%', () => {
    // Rounding 0.4% to "1%" would overstate a rare outcome, which is the
    // misleading-representation §10 treats as a compliance defect.
    expect(formatChance(0.004)).toBe('0.40%');
    expect(formatChance(0.0005)).toBe('0.05%');
  });

  it('coins always carry a plus, because a reveal is never a loss', () => {
    expect(formatRevealCoins(20)).toBe('+20');
    expect(formatRevealCoins(150)).toBe('+150');
  });

  it('producers are named for what earned them, not for chance', () => {
    expect(producerLabel('workout_complete')).toBe('Workout complete');
    expect(producerLabel('pr')).toBe('Personal record');
  });

  it('the banked label counts plainly and says nothing when empty', () => {
    expect(bankedLabel(0)).toBe('');
    expect(bankedLabel(1)).toBe('1 reveal ready');
    expect(bankedLabel(2)).toBe('2 reveals ready');
  });
});

describe('the distribution is the one on the tin', () => {
  it('a sweep of rolls lands in the advertised proportions', () => {
    // Deterministic: every roll from 0 to 999 taken once, so this is the exact
    // distribution rather than a sample of it.
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i += 1) {
      const o = pickForDisplay(i / 1000);
      counts.set(o.coins, (counts.get(o.coins) ?? 0) + 1);
    }
    for (const o of DEFAULT_REVEAL_TABLE) {
      expect(counts.get(o.coins), `${o.coins} coins`).toBe(o.weight);
    }
  });

  it('the boundaries pick the outcome the table says they do', () => {
    expect(pickForDisplay(0).coins).toBe(20);          // first per-mille
    expect(pickForDisplay(0.4499).coins).toBe(20);     // last of the 45%
    expect(pickForDisplay(0.45).coins).toBe(28);       // first of the 30%
    expect(pickForDisplay(0.9999).coins).toBe(150);    // last per-mille
    expect(pickForDisplay(1).coins).toBe(150);         // clamped, never off the end
  });
});
