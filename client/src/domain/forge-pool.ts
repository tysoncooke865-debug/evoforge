/**
 * FORGE POOL — the arithmetic of two pans (Spec v5 §4/§5, migrations 180–184).
 *
 * The athlete pledges on their own upcoming set. Friends take a side on THAT
 * proposition: BACK them, or PUSH against them. When the set is logged, the winning
 * side gets its own pledges back plus a share of the losing side, in proportion to
 * what each of them put in.
 *
 * EVERY FUNCTION HERE MIRRORS SERVER ARITHMETIC AND NONE OF IT DECIDES ANYTHING.
 * `callout_verify` (182/183) is the authority: it divides the pool, hands the
 * rounding remainder to the largest winning position, and asserts conservation
 * before it commits. These exist so the screen can say what will happen without
 * asking, and they must agree with it exactly — a projected return that differs
 * from the payout is worse than showing nothing.
 *
 * WHAT THIS IS NOT: odds. Nothing here estimates a probability, and nothing may.
 * `back` and `push` are known amounts of coins that people have already committed;
 * dividing one by the other is arithmetic on facts. §10 bans odds and the drop
 * table is the only published-chance surface in the product — a pool has no chance
 * in it at all, which is precisely why it is allowed to carry a pledge.
 */

export type PoolSide = 'back' | 'push';

export interface PoolTotals {
  back: number;
  push: number;
}

/**
 * WHICH WAY THE SCALE LEANS, from -1 (all BACK) to +1 (all PUSH).
 *
 * An empty pool sits level at 0 rather than undefined: "nobody has taken a side
 * yet" is a real state and it looks like a balanced scale, not a broken one.
 */
export function poolTilt({ back, push }: PoolTotals): number {
  const total = Math.max(0, back) + Math.max(0, push);
  if (total <= 0) return 0;
  return (Math.max(0, push) - Math.max(0, back)) / total;
}

/** Each side as a whole percentage. The two always sum to 100 when there is money. */
export function poolShare({ back, push }: PoolTotals): { backPct: number; pushPct: number } {
  const total = Math.max(0, back) + Math.max(0, push);
  if (total <= 0) return { backPct: 50, pushPct: 50 };
  const backPct = Math.round((Math.max(0, back) / total) * 100);
  return { backPct, pushPct: 100 - backPct };
}

/**
 * WHAT A POSITION RETURNS IF ITS SIDE WINS.
 *
 * `own + floor(own * losers / winners)` — the server's formula, character for
 * character, from `callout_verify`.
 *
 * THE REMAINDER IS NOT MODELLED HERE, on purpose. Integer division leaves 1–2 coins
 * that the server hands to the largest winning position, and predicting who that
 * will be requires knowing every position — which the joiner does not, and should
 * not need to. So this can understate by a coin or two and never overstates. A
 * projection that is occasionally a coin low is honest; one that promises a coin too
 * many is a bug an athlete will notice at settlement.
 */
export function poolReturn(own: number, side: PoolSide, { back, push }: PoolTotals): number {
  const stake = Math.max(0, Math.floor(own));
  if (stake <= 0) return 0;
  const winners = side === 'back' ? back : push;
  const losers = side === 'back' ? push : back;
  if (winners <= 0) return stake;
  return stake + Math.floor((stake * Math.max(0, losers)) / winners);
}

/**
 * The one-line consequence, in plain words.
 *
 * Deliberately states BOTH outcomes. A line that only says what you win is an
 * advert; §8 wants the terms legible before commitment, and the person joining is
 * not the person who can affect the result.
 */
export function poolReturnLine(
  own: number,
  side: PoolSide,
  totals: PoolTotals,
  athleteName: string
): string {
  const stake = Math.max(0, Math.floor(own));
  if (stake <= 0) return '';
  // Include this pledge in the projection: the athlete is deciding whether to add
  // it, so the number has to describe the pool as it WOULD be, not as it is.
  const withMine: PoolTotals =
    side === 'back'
      ? { back: totals.back + stake, push: totals.push }
      : { back: totals.back, push: totals.push + stake };
  const takeHome = poolReturn(stake, side, withMine);
  const other = side === 'back' ? withMine.push : withMine.back;
  const who = athleteName.trim() || 'they';
  if (other <= 0) {
    return side === 'back'
      ? `Nobody is against ${who} yet, so there is nothing to win — you would simply get your ${stake} back.`
      : `Nobody is backing ${who} yet, so there is nothing to win — you would simply get your ${stake} back.`;
  }
  const outcome = side === 'back' ? `${who} hits it` : `${who} misses`;
  return `If ${outcome} you take about ${takeHome}. If not, your ${stake} goes to the other side.`;
}

/** Is this pool still open to new positions? */
export function poolJoinable(status: string): boolean {
  return status === 'offered' || status === 'accepted';
}

/**
 * Does this pool need somebody with no position to call it? (§5)
 *
 * Mirrors `workout_callout_config.independent_verifier_at`, default 200. Shown so
 * the athlete understands why a big pool is waiting on a third person rather than
 * on their opponent.
 */
export const INDEPENDENT_VERIFIER_AT = 200;

export function needsIndependentVerifier(
  totals: PoolTotals,
  threshold = INDEPENDENT_VERIFIER_AT
): boolean {
  return Math.max(0, totals.back) + Math.max(0, totals.push) >= threshold;
}
