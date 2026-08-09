import type { DropTier } from './forge-drop';

/**
 * HOW BIG DID THAT FEEL — decided once, in one place.
 *
 * Every celebration in Forge Drop keys off this: the burst size, the ring
 * count, the shake, the sound, the border colour on the result card, whether
 * the interface dims. Putting it in the domain layer rather than in the view
 * means the answer is the same everywhere and can be asserted without a canvas.
 *
 * IT READS THE LEDGER, NEVER THE ANIMATION. A tier is derived from the stake
 * and the payout the server actually paid — so a celebration can never be
 * bigger than the money, and no effect anywhere can be triggered by something
 * that did not happen.
 *
 * THERE IS NO NEAR-MISS TIER, DELIBERATELY. A loss that lands next to the big
 * multiplier is a loss, and dressing it as an almost-win is the single most
 * common dark pattern in this genre. `outcomeTier` cannot express it, which is
 * the point: it is not a policy the view is trusted to follow, it is a value
 * the view cannot construct.
 */
export type OutcomeTier = 'loss' | 'even' | 'win' | 'big' | 'jackpot';

/** The multiplier that only the rim slots pay — the tier's own ceiling. */
export function topMultiplier(tier: DropTier): number {
  return tier.multipliers.reduce((a, b) => (b > a ? b : a), 0);
}

export function outcomeTier(
  stake: number,
  payout: number,
  multiplier: number,
  tier: DropTier
): OutcomeTier {
  // The ceiling is the ceiling: paying the board's largest multiplier is the
  // rarest thing that can happen on it, and the only thing that earns the
  // full-screen moment.
  if (multiplier >= topMultiplier(tier) - 1e-9) return 'jackpot';
  if (payout >= stake * 2) return 'big';
  if (payout > stake) return 'win';
  if (payout === stake) return 'even';
  return 'loss';
}

export interface Celebration {
  /** Expanding shockwave rings at the landing point. */
  rings: number;
  /** Particles thrown from the slot. Capped hard — see `FX_BUDGET`. */
  sparks: number;
  /** Board recoil, in board-relative units. 0 is perfectly still. */
  shake: number;
  /** Dim everything except the board. Reserved for the ceiling. */
  dim: boolean;
  /** Milliseconds the payout headline holds before the card settles. */
  holdMs: number;
  /** The token name the burst is drawn in. Never a colour literal — the theme
   *  owns what gold and cyan actually are. */
  tone: 'legendary' | 'accent' | 'rare' | 'text-dim';
  /** What the card calls it. Plain, never triumphant about a loss. */
  callout: string;
}

/**
 * WHAT EACH OUTCOME IS ALLOWED TO DO.
 *
 * The gradient is deliberate and asymmetric: a loss is quiet and legible, a
 * win is energetic, and only the board's own ceiling gets to interrupt the
 * interface. A game that celebrates every outcome equally teaches nothing, and
 * a game that punishes losses teaches something worse.
 */
export function celebrationFor(tier: OutcomeTier): Celebration {
  switch (tier) {
    case 'jackpot':
      return { rings: 3, sparks: 18, shake: 1, dim: true, holdMs: 1400, tone: 'legendary', callout: 'MAX MULTIPLIER' };
    case 'big':
      return { rings: 2, sparks: 12, shake: 0.55, dim: false, holdMs: 900, tone: 'legendary', callout: 'BIG RETURN' };
    case 'win':
      return { rings: 1, sparks: 6, shake: 0.25, dim: false, holdMs: 700, tone: 'accent', callout: 'RETURN' };
    case 'even':
      return { rings: 1, sparks: 3, shake: 0.12, dim: false, holdMs: 600, tone: 'rare', callout: 'STAKE BACK' };
    default:
      // A loss still lands — silence would read as a dropped frame — but it
      // lands in the cool end of the palette and says only what happened.
      //
      // "BELOW STAKE", not "NO RETURN". Most losing slots pay SOMETHING: 0.7x
      // on a 10-coin chip returns 7, and calling that "no return" while the
      // card underneath reads "7 BACK" is a plain contradiction. The athlete is
      // told the one true thing — less came back than went in.
      return { rings: 1, sparks: 2, shake: 0.1, dim: false, holdMs: 600, tone: 'text-dim', callout: 'BELOW STAKE' };
  }
}

/**
 * THE EFFECT BUDGET.
 *
 * Five chips can be in the air at once, each striking twelve pegs, each strike
 * wanting a ring and a spark. Unbudgeted that is hundreds of live views inside
 * two seconds, on a phone, during a workout.
 *
 * So effects come from FIXED POOLS that are allocated once and recycled. The
 * pools cannot grow, which means the worst case is the same as the normal case
 * and there is no leak to find later — a particle system that can only ever
 * hold N things is one that cannot accumulate.
 */
export const FX_BUDGET = {
  /** Peg-strike rings live in flight, across every chip. */
  pegRings: 14,
  /** Landing shockwaves. Five chips can land almost together. */
  landingRings: 6,
  /** Sparks in flight, across everything. */
  sparks: 24,
  /** Ambient drifting motes behind the pegs. */
  motes: 10,
  /** Electrical arcs between peg groups. */
  arcs: 2,
} as const;

/**
 * HOW BRIGHT A PEG STRIKE IS, given who struck it.
 *
 * Higher stakes read louder, so a 25-coin chip is trackable among 1-coin chips
 * without needing a label on it. Normalised against the board's own ceiling
 * rather than an absolute, so the quietest chip on CELESTIAL FORGE is not
 * dimmer than the loudest on SCRAP RIG.
 */
export function strikeIntensity(stake: number, tier: DropTier): number {
  const ceiling = Math.max(1, tier.max_stake);
  const share = Math.min(1, Math.max(0, stake / ceiling));
  // Never fully dark: the smallest legal stake still gets a visible hit.
  return 0.45 + share * 0.55;
}

/**
 * THE SUSPENSE RAMP — 0 at the top of the board, 1 at the slot.
 *
 * Used to brighten the puck and thicken its trail as it falls, so the descent
 * builds rather than merely happens. Eased so the last two rows carry most of
 * the change, which is where the tension actually is.
 */
export function tension(y: number, rows: number): number {
  const p = Math.min(1, Math.max(0, y / Math.max(1, rows)));
  return p * p * p;
}

/**
 * THE SLOW-MOTION MOMENT, as a time scale.
 *
 * Returns the multiplier to apply to the clock for a puck this far through its
 * fall. Time is only ever slowed — never sped up, and never past the point
 * where the chip appears to hang — and it is released the instant it lands, so
 * the result is not delayed by more than a beat.
 *
 * A REPLAY MUST STAY A REPLAY. Slowing the clock changes when the athlete sees
 * the outcome, never what it is: the trajectory is already fixed and the slot
 * is already paid.
 */
export const SLOWMO_FROM = 0.86;
export function timeScale(progress: number, reduced: boolean): number {
  if (reduced) return 1;
  if (progress < SLOWMO_FROM || progress >= 1) return 1;
  const into = (progress - SLOWMO_FROM) / (1 - SLOWMO_FROM);
  // Down to 0.45x at its deepest, then back — a held breath, not a stall.
  return 1 - 0.55 * Math.sin(into * Math.PI);
}

/**
 * STAGGER, so several chips do not land on the same frame.
 *
 * A cascade reads as several results; a simultaneous thud reads as one. The
 * offset is small, derived from the chip's own position in the queue, and
 * capped so nobody waits meaningfully longer for a result that is already
 * decided.
 */
export function landingStagger(index: number): number {
  return Math.min(index, 4) * 0.11;
}
