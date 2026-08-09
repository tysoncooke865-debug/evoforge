/**
 * FORGE DROP — the board, as arithmetic.
 *
 * Pure functions only. Migrations 154/155 own the tiers, the walk and every
 * coin that moves; this file re-derives the SAME maths so the payout table an
 * athlete reads before they commit is the real one, and so a test can hold both
 * to account without a network.
 *
 * THE ONE ECONOMIC INVARIANT: every tier, and every LANE of every tier, returns
 * less than it takes. `validateTier` is what makes that a fact rather than an
 * intention, and `__tests__/forge-drop.test.ts` runs it over the shipped board.
 *
 * FORGE COINS ARE FICTIONAL. Earned by training, not purchasable, not
 * withdrawable, not transferable. Forge Drop moves them and touches nothing
 * else — the Evo Rating decides which board you are on and is never written to.
 */

// ─────────────────────────────────────────────────────────────── the board

export interface DropTier {
  tier: number;
  evo_min: number;
  evo_max: number;
  label: string;
  theme: DropTheme;
  min_stake: number;
  max_stake: number;
  target_rtp: number;
  max_payout: number;
  multipliers: number[];
  rows: number;
  lanes: number[];
  config_version: number;
}

export type DropTheme = 'rust' | 'iron' | 'cyber' | 'reactor' | 'celestial';

/**
 * A FIRST-PAINT FALLBACK AND NOTHING MORE. `forge_drop_tiers` is the authority
 * — rebalancing is an UPDATE, not a deploy — and this mirrors what 154 seeds so
 * the board can be drawn before the row arrives. The test suite asserts the two
 * agree, so a tier retuned in SQL without touching this file is caught rather
 * than shipped as a lie on the payout table.
 */
export const DEFAULT_DROP_TIERS: DropTier[] = [
  { tier: 1, evo_min: 0, evo_max: 20, label: 'SCRAP RIG', theme: 'rust',
    min_stake: 1, max_stake: 5, target_rtp: 0.8, max_payout: 15,
    multipliers: [3, 1.35, 1.18, 1, 0.83, 0.65, 0.65, 0.65, 0.83, 1, 1.18, 1.35, 3], rows: 12, lanes: [5, 6, 7], config_version: 1 },
  { tier: 2, evo_min: 21, evo_max: 40, label: 'FORGE LINE', theme: 'iron',
    min_stake: 1, max_stake: 10, target_rtp: 0.83, max_payout: 35,
    multipliers: [3.5, 1.3, 1.15, 1, 0.85, 0.7, 0.7, 0.7, 0.85, 1, 1.15, 1.3, 3.5], rows: 12, lanes: [5, 6, 7], config_version: 1 },
  { tier: 3, evo_min: 41, evo_max: 60, label: 'CYBER FOUNDRY', theme: 'cyber',
    min_stake: 1, max_stake: 15, target_rtp: 0.86, max_payout: 60,
    multipliers: [4, 1.45, 1.26, 1.08, 0.89, 0.7, 0.7, 0.7, 0.89, 1.08, 1.26, 1.45, 4], rows: 12, lanes: [5, 6, 7], config_version: 1 },
  { tier: 4, evo_min: 61, evo_max: 80, label: 'REACTOR CORE', theme: 'reactor',
    min_stake: 1, max_stake: 20, target_rtp: 0.89, max_payout: 100,
    multipliers: [5, 1.4, 1.24, 1.08, 0.91, 0.75, 0.75, 0.75, 0.91, 1.08, 1.24, 1.4, 5], rows: 12, lanes: [5, 6, 7], config_version: 1 },
  { tier: 5, evo_min: 81, evo_max: 1000, label: 'CELESTIAL FORGE', theme: 'celestial',
    min_stake: 1, max_stake: 25, target_rtp: 0.92, max_payout: 150,
    multipliers: [6, 1.3, 1.18, 1.05, 0.93, 0.8, 0.8, 0.8, 0.93, 1.05, 1.18, 1.3, 6], rows: 12, lanes: [5, 6, 7], config_version: 1 },
];

/** Which board an Evo Rating is on. Mirrors `forge_drop_tier_for`, including
 *  its answer for an athlete no review has ever rated: the lowest board. */
export function tierForRating(rating: number | null | undefined, tiers = DEFAULT_DROP_TIERS): DropTier {
  const r = Math.max(0, Math.min(1000, Math.floor(rating ?? 0)));
  return tiers.find((t) => r >= t.evo_min && r <= t.evo_max) ?? tiers[0];
}

// ────────────────────────────────────────────────────────────── the odds

/**
 * WHERE A PUCK DROPPED IN THIS LANE ACTUALLY LANDS.
 *
 * The exact distribution of the server's walk, by dynamic programming rather
 * than simulation: `rows` fair steps from `lane`, REFLECTING at the walls.
 *
 * Reflection, not clamping, and the difference is the whole economy. Clamping
 * parks probability against the rim — which is precisely where the 3× and 6×
 * multipliers live — and turns an 80% board into one that pays out more than it
 * takes. The server reflects (155); so does this.
 */
export function laneDistribution(rows: number, lane: number): number[] {
  // HALF COLUMNS. A peg deflects the puck by half a column, so the walk is
  // tracked in halves: `h` runs 0 … 2*rows and the landing slot is h/2.
  //
  // Stepping WHOLE columns is the bug this shape exists to avoid: after an even
  // number of steps the puck could only reach every OTHER slot, half the board
  // was unreachable, and the parity artefact dumped the walk against the rim
  // where the biggest multiplier lives — a side lane's return went over 100%.
  // The statistical test found it; no amount of reading the code did.
  const H = 2 * rows;
  let dist = new Map<number, number>([[2 * Math.max(0, Math.min(rows, lane)), 1]]);
  for (let step = 0; step < rows; step += 1) {
    const next = new Map<number, number>();
    for (const [h, p] of dist) {
      for (const dir of [-1, 1]) {
        // The wall sends it back the way it came, exactly as 155 does.
        const to = h + dir < 0 || h + dir > H ? h - dir : h + dir;
        next.set(to, (next.get(to) ?? 0) + p / 2);
      }
    }
    dist = next;
  }
  const out = new Array<number>(rows + 1).fill(0);
  for (const [h, p] of dist) out[h / 2] += p;
  return out;
}

/** Expected return for one lane, as a fraction of the stake. */
export function laneRtp(multipliers: readonly number[], distribution: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < multipliers.length; i += 1) sum += multipliers[i] * (distribution[i] ?? 0);
  return sum;
}

/** Every lane's odds and return, ready to publish. */
export interface LaneOdds {
  lane: number;
  distribution: number[];
  rtp: number;
}

export function tierOdds(tier: DropTier): LaneOdds[] {
  return tier.lanes.map((lane) => {
    const distribution = laneDistribution(tier.rows, lane);
    return { lane, distribution, rtp: laneRtp(tier.multipliers, distribution) };
  });
}

/**
 * WHAT A SLOT PAYS — the GUARANTEED part.
 *
 * A payout must be whole coins, but `stake x multiplier` rarely is, and what
 * happens to the fraction decides whether the published RTP is true.
 *
 * Flooring it — the obvious choice, and the one this shipped with first —
 * quietly destroys the board. Flooring loses up to a coin per drop no matter
 * how small the stake, so at a 1-coin stake on CYBER FOUNDRY every slot below
 * 1x pays zero and the real return is 15%, against a published 86%. The number
 * on the tin was for a continuous game nobody was playing.
 *
 * So the fraction is paid as a PROBABILITY instead (see `fractionalChance`):
 * 10.5 coins is 10 coins and a coin-flip for the eleventh. The expectation is
 * exactly 10.5, which makes the tier's target RTP true at EVERY stake rather
 * than only in the limit. It is also strictly better for the athlete than
 * flooring at every stake, and it can never exceed the published ceiling: the
 * top multiplier of every tier lands on a whole number at max stake, so there
 * is no fraction left to round up.
 *
 * This returns the floor — what the slot pays for certain. `fractionalChance`
 * returns the odds of one more.
 */
export function payoutFor(stake: number, multiplier: number): number {
  // EXACT, TO THE CENT. Coins carry two decimal places (migration 158), so
  // there is no fraction left to floor and none to gamble away — a 1-coin chip
  // on 0.89x returns 0.89. The probabilistic rounding this replaced existed
  // only because a payout had to be a whole coin.
  return Math.round(stake * multiplier * 100) / 100;
}

/** Kept at zero: nothing is rounded any more, so nothing is owed as a chance
 *  of one more coin. The payout table reads this to decide whether to show a
 *  range, and now never does. */
export function fractionalChance(_stake?: number, _multiplier?: number): number {
  return 0;
}

/** The two amounts a slot can pay, and how often the larger one lands. Used by
 *  the payout table, so the athlete reads "10 or 11" rather than a mean they
 *  can never actually receive. */
export function payoutRange(
  stake: number,
  multiplier: number
): { low: number; high: number; pHigh: number } {
  const low = payoutFor(stake, multiplier);
  const pHigh = fractionalChance(stake, multiplier);
  return { low, high: pHigh > 0 ? low + 1 : low, pHigh };
}

/**
 * WHAT THIS STAKE ACTUALLY RETURNS — the number the athlete is shown.
 *
 * Computed from the payout the athlete can actually receive, in whole coins,
 * rather than from the multipliers directly — so if the rounding rule ever
 * changes, the published number changes with it instead of drifting away from
 * it silently. That drift is exactly what went wrong when payouts were
 * floored: the screen said 86% and the board paid 15%.
 *
 * With the fraction paid as a probability this now agrees with `laneRtp` to
 * floating-point noise at every stake, and the test suite asserts that rather
 * than assuming it.
 */
export function effectiveRtp(
  multipliers: readonly number[],
  distribution: readonly number[],
  stake: number
): number {
  if (stake <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < multipliers.length; i += 1) {
    const m = multipliers[i];
    // floor + P(one more) — the expectation of what the resolver pays.
    sum += (distribution[i] ?? 0) * (payoutFor(stake, m) + fractionalChance(stake, m));
  }
  return sum / stake;
}

// ──────────────────────────────────────────────────────── the guard rails

export interface TierProblem {
  tier: number;
  problem: string;
}

/**
 * IS THIS BOARD SAFE TO SHIP?
 *
 * Run over the shipped tiers by the test suite and over the LIVE rows by
 * tools/falsify-forge-drop.mjs, so a rebalance done in SQL is checked by the
 * same rules as one done in TypeScript.
 *
 * `maxRtp` is the ceiling that matters. It is well under 1 rather than at it:
 * a board that returned 99.9% would be a coin printer for anyone patient, and
 * "below 100%" is not a design, it is the absence of a catastrophe.
 */
export function validateTier(tier: DropTier, opts: { tolerance?: number; maxRtp?: number } = {}): TierProblem[] {
  const tolerance = opts.tolerance ?? 0.01;
  const maxRtp = opts.maxRtp ?? 0.95;
  const out: TierProblem[] = [];
  const say = (problem: string) => out.push({ tier: tier.tier, problem });

  if (tier.multipliers.length !== tier.rows + 1) {
    say(`${tier.multipliers.length} multipliers for ${tier.rows} rows — expected ${tier.rows + 1}`);
    return out;
  }
  if (tier.multipliers.some((m) => !Number.isFinite(m) || m < 0)) say('a multiplier is negative or not a number');
  if (tier.min_stake < 1) say('the minimum stake is below one coin');
  if (tier.max_stake < tier.min_stake) say('the stake ceiling is below the floor');
  if (tier.lanes.length === 0) say('no lanes');
  for (const lane of tier.lanes) {
    if (lane < 0 || lane > tier.rows) say(`lane ${lane} is off the board`);
  }

  const best = Math.max(...tier.multipliers);
  const promised = Math.floor(tier.max_stake * best);
  if (promised !== tier.max_payout) {
    say(`max_payout says ${tier.max_payout} but the board pays ${promised} at the ceiling`);
  }

  let bestLane = 0;
  for (const { lane, rtp } of tierOdds(tier)) {
    if (rtp >= maxRtp) say(`lane ${lane} returns ${(rtp * 100).toFixed(1)}% — at or above the ${maxRtp * 100}% ceiling`);
    if (rtp >= 1) say(`lane ${lane} returns ${(rtp * 100).toFixed(1)}% — the board pays out more than it takes`);
    // THE TARGET IS A CEILING, NOT AN AVERAGE. Every lane must sit at or below
    // it, and the UI publishes each lane's own exact number. A ceiling is a
    // promise that can be checked; an average is one that cannot.
    if (rtp > tier.target_rtp + tolerance) {
      say(`lane ${lane} returns ${(rtp * 100).toFixed(1)}%, above its ${(tier.target_rtp * 100).toFixed(0)}% ceiling`);
    }
    bestLane = Math.max(bestLane, rtp);
  }
  // …and not so far below it that the published figure is meaningless.
  if (bestLane < tier.target_rtp - 0.05) {
    say(`the best lane returns ${(bestLane * 100).toFixed(1)}%, far under the ${(tier.target_rtp * 100).toFixed(0)}% it advertises`);
  }
  return out;
}

// ───────────────────────────────────────────────────────────── the replay

export interface DropResult {
  drop_id: string;
  replayed: boolean;
  tier: number;
  evo_rating: number;
  lane: number;
  stake: number;
  slot: number;
  multiplier: number;
  payout: number;
  net: number;
  path: number[];
  config_version: number;
  balance: number;
}

/**
 * WHERE THE PUCK IS AFTER EACH ROW.
 *
 * The animation REPLAYS the server's walk; it does not compute one. Given the
 * path 155 already took, this is the column at every row — which is all the
 * board needs to draw a fall that lands where the ledger already says it did.
 *
 * If the path and the recorded slot ever disagree, the SLOT wins: it is what
 * was paid. `columnsFor` returns null in that case so the caller can drop the
 * puck straight down the honest way rather than animate a lie.
 */
export function columnsFor(
  result: Pick<DropResult, 'lane' | 'path' | 'slot'>,
  rows: number
): number[] | null {
  if (result.path.length !== rows) return null;
  let h = 2 * result.lane;
  const cols: number[] = [h / 2];
  for (const step of result.path) {
    if (step !== 1 && step !== -1) return null;
    h += step;
    if (h < 0 || h > 2 * rows) return null;
    cols.push(h / 2);
  }
  // THE LEDGER WINS. If the path and the paid slot disagree, refuse to animate
  // rather than animate a lie — the caller drops the puck straight to the slot
  // that was actually paid.
  if (h / 2 !== result.slot) return null;
  return cols;
}

/** "×3.0" / "×0.65" — the multiplier as an athlete reads it. */
export function formatMultiplier(m: number): string {
  return `×${m % 1 === 0 ? m.toFixed(0) : String(Number(m.toFixed(2)))}`;
}

/** The quick stake buttons a tier offers: the floor, half the ceiling and the
 *  ceiling — deduplicated, and never above what the athlete can actually
 *  afford, so no affordance can produce a wager the server would refuse. */
export function quickStakes(tier: DropTier, balance: number): number[] {
  const ceiling = Math.min(tier.max_stake, Math.max(0, Math.floor(balance)));
  if (ceiling < tier.min_stake) return [];
  const half = Math.max(tier.min_stake, Math.floor(ceiling / 2));
  return [...new Set([tier.min_stake, half, ceiling])].filter((s) => s >= tier.min_stake && s <= ceiling);
}

export function clampStake(stake: number, tier: DropTier, balance: number): number {
  const ceiling = Math.min(tier.max_stake, Math.max(0, Math.floor(balance)));
  return Math.max(tier.min_stake, Math.min(Math.floor(stake), ceiling));
}

export function canAfford(tier: DropTier, balance: number): boolean {
  return Math.floor(balance) >= tier.min_stake;
}

/**
 * COINS, AS MONEY.
 *
 * Whole amounts stay whole — "15", not "15.00", because most of the economy is
 * whole coins and a wall of trailing zeroes reads as noise. Anything with cents
 * shows both digits: 10.5 is written 10.50, because a payout that looks like it
 * has one decimal place invites the question of whether the other one was lost.
 */
export function formatCoin(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
