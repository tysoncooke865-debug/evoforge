import { clampStake, type DropTier } from './forge-drop';

/**
 * FORGE DROP — THE SESSION, WITH SEVERAL CHIPS IN THE AIR.
 *
 * One drop at a time needs no state model: you have a balance, you stake, you
 * find out. Concurrency is what makes this file necessary. The moment a second
 * chip can leave the rack while the first is still falling, three questions
 * appear that a single-drop screen never had to answer:
 *
 *   1. What can this athlete still afford, given coins already committed to
 *      chips that have not landed?
 *   2. What should the balance READ while a winning chip is mid-fall — the
 *      number that includes the win nobody has seen yet, or the one that does
 *      not?
 *   3. When a result arrives for the second chip before the first, what
 *      changes and what does not?
 *
 * Every function here is pure. The screen holds the state, the server holds
 * the money, and this decides what the two of them mean together.
 */

// ─────────────────────────────────────────────────────────── denominations

/**
 * THE RACK. Six denominations, which is enough to make 30 a decision (25 + 5)
 * and few enough to sit in one row on a 320px phone.
 *
 * Not `FORGE_CHIPS` — the duel's ladder starts at 5 and runs to 500, because a
 * duel is a week-long wager between two people. A board with a 5-coin ceiling
 * needs a 1, and nothing here needs a 500.
 */
export const DROP_CHIPS = [1, 5, 10, 15, 25, 50] as const;
export type DropChipValue = (typeof DROP_CHIPS)[number];

/** Each denomination's tone, as TOKEN NAMES resolved against the live theme —
 *  never a colour invented here. Borrowed from the rarity ladder so a 50 reads
 *  as rare the same way a legendary item does. */
export const DROP_CHIP_TONE: Readonly<Record<DropChipValue, string>> = {
  1: 'text-dim',
  5: 'common',
  10: 'rare',
  15: 'accent',
  25: 'legendary',
  50: 'mythic',
};

// ──────────────────────────────────────────────────────────────── the drops

/**
 * A drop's life. The distinction that matters is `revealed`: a falling chip has
 * ALREADY settled on the server — the coins moved, the result is decided — but
 * the athlete has not seen it yet.
 *
 * - `pending`  — the request is out, no answer. The server may or may not have
 *                taken the stake. We assume it has.
 * - `falling`  — the server answered. Stake taken, payout credited, chip in the
 *                air. The result exists and is deliberately not shown.
 * - `revealed` — the chip landed and the athlete has been told.
 * - `failed`   — the server refused. Nothing was taken; nothing is owed.
 */
export type DropPhase = 'pending' | 'falling' | 'revealed' | 'failed';

export interface SessionDrop {
  /** The idempotency key. Minted and written to disk BEFORE the request. */
  key: string;
  stake: number;
  lane: number;
  phase: DropPhase;
  /** Server-assigned, absent until it answers. */
  dropId?: string;
  slot?: number;
  multiplier?: number;
  payout?: number;
  net?: number;
  path?: number[];
  tier?: number;
  /** Set when `phase === 'failed'`, so the rail can say why. */
  error?: string;
}

export const isInFlight = (d: SessionDrop): boolean =>
  d.phase === 'pending' || d.phase === 'falling';

// ──────────────────────────────────────────────────────────────── the money

export interface SessionBalance {
  /** Spendable right now. Never optimistic, never above the truth. */
  available: number;
  /** Committed to chips that have not landed. */
  reserved: number;
  /** What the balance becomes once every chip in the air has landed. */
  projected: number;
  /** How many chips are in the air. */
  activeCount: number;
}

/**
 * WHAT THE ATHLETE HAS, WHILE CHIPS ARE STILL FALLING.
 *
 * `server` is the server's own `coin_total()` — the only authority on what this
 * wallet holds. Every drop that has settled is ALREADY in it, including the
 * payouts of chips still in the air, because a chip is settled before it starts
 * falling. The animation decides when the athlete is TOLD, never what is true.
 *
 * So the adjustments run in exactly one direction: hide what has not been
 * shown.
 *
 *   falling  — the server counted the stake and the payout. Count the stake,
 *              subtract the payout back out. The chip reads as a loss until it
 *              lands, so the balance can never announce a win the animation is
 *              still on its way to deliver.
 *   pending  — the request is out and the cached total predates it. Subtract
 *              the stake, so coins committed to a chip already thrown cannot be
 *              committed again.
 *   revealed — fully reflected in `server`, and fully shown. Nothing to adjust.
 *
 * THE EARLIER VERSION OF THIS ANCHORED to the balance at the moment the board
 * last went quiet and applied every movement on top. It double-counted: once
 * the board went quiet again the anchor became the server's post-settlement
 * total, and the revealed drops were then re-applied to it. The browser tour
 * caught it as a one-coin disagreement between the header and the ledger —
 * small, permanent, and exactly the kind of drift that makes a wallet
 * untrustworthy. Deriving from the server every time cannot drift, because
 * there is nothing to keep in step.
 */
export function sessionBalance(server: number, drops: readonly SessionDrop[]): SessionBalance {
  let hidden = 0;   // settled and in `server`, but not yet shown
  let unsent = 0;   // thrown, not yet acknowledged by the cached total
  let reserved = 0;
  let known = 0;
  let active = 0;

  for (const d of drops) {
    if (d.phase === 'failed' || d.phase === 'revealed') continue;
    reserved += d.stake;
    active += 1;
    if (d.phase === 'falling') {
      hidden += d.payout ?? 0;
      known += d.payout ?? 0;
    } else {
      unsent += d.stake;
    }
  }

  const available = server - hidden - unsent;
  return {
    available,
    reserved,
    // Everything spendable, plus the wins already decided but not yet shown.
    // Equal to `available` once the board is quiet.
    projected: available + known,
    activeCount: active,
  };
}

/** The board is quiet — every chip has landed and been seen. The only moment
 *  it is safe to re-anchor to a freshly fetched balance. */
export const isQuiet = (drops: readonly SessionDrop[]): boolean =>
  !drops.some(isInFlight);

/** What the session did, for the summary strip. Revealed drops only — a
 *  running total that counted unrevealed wins would spoil them too. */
export function sessionSummary(drops: readonly SessionDrop[]): {
  drops: number;
  staked: number;
  returned: number;
  net: number;
} {
  let n = 0, staked = 0, returned = 0;
  for (const d of drops) {
    if (d.phase !== 'revealed') continue;
    n += 1;
    staked += d.stake;
    returned += d.payout ?? 0;
  }
  return { drops: n, staked, returned, net: returned - staked };
}

// ───────────────────────────────────────────────────────────────── capacity

/**
 * HOW MANY CHIPS MAY BE IN THE AIR.
 *
 * Three on a phone, five on a desktop. Not a difficulty setting — a legibility
 * one. Five pucks crossing a 320px board is a smear, and a result rail with
 * five rows on a phone pushes the rack under the fold. The limit is on
 * UNREVEALED drops, so a fast athlete is throttled by what they can watch, not
 * by what they can afford.
 */
export const MOBILE_MAX_DROPS = 3;
export const DESKTOP_MAX_DROPS = 5;
/** The width at which the board is wide enough to read five pucks at once. */
export const DESKTOP_MIN_WIDTH = 768;

export const dropCapacity = (width: number): number =>
  width >= DESKTOP_MIN_WIDTH ? DESKTOP_MAX_DROPS : MOBILE_MAX_DROPS;

// ──────────────────────────────────────────────────────── what you may play

export interface ChipOffer {
  value: number;
  enabled: boolean;
  /** Why not — shown to the athlete and read by a screen reader. Never a bare
   *  disabled control: a chip that cannot be played without saying why reads
   *  as a broken button. */
  reason?: string;
}

/**
 * WHICH CHIPS CAN BE PLAYED, AND WHY THE OTHERS CANNOT.
 *
 * Checked against the board's ceiling and against what is left AFTER coins
 * already committed to chips in the air — because the second chip has to be
 * paid for out of what the first one left behind, not out of the balance as it
 * looked before the athlete started.
 */
export function chipOffers(
  tier: DropTier,
  balance: SessionBalance,
  capacity: number,
  denominations: readonly number[] = DROP_CHIPS
): ChipOffer[] {
  const atCapacity = balance.activeCount >= capacity;
  return denominations.map((value) => {
    if (value < tier.min_stake) {
      return { value, enabled: false, reason: `below this board's ${tier.min_stake} minimum` };
    }
    if (value > tier.max_stake) {
      return { value, enabled: false, reason: `over ${tier.label}'s ${tier.max_stake} ceiling` };
    }
    if (atCapacity) {
      return { value, enabled: false, reason: `${capacity} chips already falling` };
    }
    if (value > balance.available) {
      return {
        value,
        enabled: false,
        reason: balance.reserved > 0
          ? `${balance.available} left with ${balance.reserved} in play`
          : `you have ${balance.available}`,
      };
    }
    return { value, enabled: true };
  });
}

/** Can ANY chip be played right now — and if not, the single honest reason.
 *  Drives the one message under the rack, so the athlete is never left reading
 *  six disabled chips to work out what is wrong. */
export function rackBlocker(
  tier: DropTier,
  balance: SessionBalance,
  capacity: number,
  denominations: readonly number[] = DROP_CHIPS
): string | null {
  if (balance.activeCount >= capacity) {
    return `${capacity} chips are already falling — wait for one to land`;
  }
  const cheapest = Math.max(tier.min_stake, Math.min(...denominations));
  if (balance.available < cheapest) {
    return balance.reserved > 0
      ? `${balance.available} left with ${balance.reserved} in play`
      : 'Not enough Forge Coins — earn more by training';
  }
  return null;
}

/**
 * THE STAKE A FLICK ACTUALLY SENDS.
 *
 * Clamped to the board and to what is affordable RIGHT NOW, so the value that
 * leaves the rack is one the server will accept. Returns null when nothing is
 * playable, which is a refusal to send rather than a request that will bounce.
 */
export function stakeFor(
  chip: number,
  tier: DropTier,
  balance: SessionBalance
): number | null {
  // Clamped to the BOARD, deliberately not to the wallet. Clamping down to
  // whatever is affordable would quietly turn a 15-coin chip into a 3-coin
  // wager — the athlete picked a chip, and staking a different amount than the
  // one they picked up is not a smaller version of consent.
  const wanted = clampStake(chip, tier, Number.POSITIVE_INFINITY);
  if (wanted > balance.available || wanted < tier.min_stake) return null;
  return wanted;
}

// ────────────────────────────────────────────────────────────────── the lane

export type LaneChoice = 'left' | 'centre' | 'right';

/** The three entry lanes, in flick order. A board always has three; this
 *  reads them off the tier rather than assuming which they are. */
export function laneFor(choice: LaneChoice, tier: DropTier): number {
  const lanes = [...tier.lanes].sort((a, b) => a - b);
  if (lanes.length === 0) return 0;
  if (choice === 'left') return lanes[0];
  if (choice === 'right') return lanes[lanes.length - 1];
  return lanes[Math.floor(lanes.length / 2)];
}

export function choiceForLane(lane: number, tier: DropTier): LaneChoice {
  const lanes = [...tier.lanes].sort((a, b) => a - b);
  if (lane <= lanes[0]) return 'left';
  if (lane >= lanes[lanes.length - 1]) return 'right';
  return 'centre';
}

/**
 * WHICH LANE A FLICK MEANT.
 *
 * Horizontal travel picks the lane; vertical travel is what makes it a flick
 * rather than a drag. Both are measured against the chip's own size so the
 * gesture feels the same on a 320px phone and a 1280px desktop.
 *
 * Returns null when the gesture was not a flick at all — too slow and too
 * short — which is how a cancelled or accidental drag returns the chip to the
 * rack WITHOUT staking anything. A wager must never be the default outcome of
 * touching the screen.
 */
export function flickLane(
  gesture: { dx: number; dy: number; vx: number; vy: number },
  chipSize: number
): LaneChoice | null {
  const launchDistance = chipSize * 0.9;
  const launchVelocity = 320; // px/s upward — a deliberate throw, not a nudge

  const thrown = gesture.dy <= -launchDistance || gesture.vy <= -launchVelocity;
  if (!thrown) return null;

  // Sideways intent is read from travel AND speed, so both a long slow arc and
  // a short sharp flick pick the same lane.
  const sideways = gesture.dx + gesture.vx * 0.12;
  const gate = chipSize * 0.55;
  if (sideways <= -gate) return 'left';
  if (sideways >= gate) return 'right';
  return 'centre';
}

/**
 * THE LANE A SLOW DRAG IS PREVIEWING.
 *
 * Same reading of sideways intent, without the launch test — so the board can
 * highlight where the chip would go while the thumb is still down, and the
 * athlete can change their mind before committing. Always returns a lane;
 * previewing is free.
 */
export function previewLane(dx: number, chipSize: number): LaneChoice {
  const gate = chipSize * 0.55;
  if (dx <= -gate) return 'left';
  if (dx >= gate) return 'right';
  return 'centre';
}
