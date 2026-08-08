/**
 * WAGER PROGRESSION — the part of a challenge that makes an athlete want one
 * more, WITHOUT any of it being chance.
 *
 * The distinction matters and is deliberate. Everything here is earned by
 * training: the coins are non-purchasable, the outcome is computed from logged
 * sessions, and nothing below introduces randomness, a drop table or a
 * near-miss. The tension comes from a visible target — a streak two wins from
 * a milestone, a rival three cardio minutes ahead — not from a spin.
 *
 * CONFIDENCE IS A BAND, NEVER A NUMBER. "Slight advantage" invites you to
 * train; "68% to win" invites you to calculate, and a percentage on a contest
 * decided by future training is a false precision that would deserve to be
 * disbelieved. The band is derived from the CURRENT scores of a live contest
 * and says how it stands, not how it will end.
 */

import { myResult, sideScore, sidesOf, type ForgeChallenge } from './forge-challenge';

// ─────────────────────────────────────────────────────────────── the streak

export interface WinStreak {
  /** Consecutive wins ending at the most recent settled challenge. */
  current: number;
  /** The longest run this athlete has ever put together. */
  best: number;
  /** The next milestone above `current`, or null past the last one. */
  nextMilestone: number | null;
  /** Wins still needed to reach it. */
  toNext: number | null;
}

/** Deliberately close together at the start: the first milestone must be
 *  reachable from a standing start, or it is not a target, it is a wall. */
export const STREAK_MILESTONES = [3, 5, 10, 20] as const;

/**
 * A DRAW DOES NOT BREAK A STREAK, and does not extend it.
 *
 * Losing is the only thing that resets. A draw means both athletes trained to
 * the same standard — punishing that would teach people to avoid evenly
 * matched opponents, which is exactly the competition worth having.
 */
export function winStreak(rows: readonly ForgeChallenge[], myId: string): WinStreak {
  const settled = rows
    .filter((c) => c.status === 'settled' && c.settled_at !== null)
    .sort((a, b) => Date.parse(String(a.settled_at)) - Date.parse(String(b.settled_at)));

  let current = 0;
  let best = 0;
  for (const c of settled) {
    const r = myResult(c, myId);
    if (r === 'won') {
      current += 1;
      if (current > best) best = current;
    } else if (r === 'lost') {
      current = 0;
    }
    // A draw leaves the run exactly where it was.
  }

  const nextMilestone = STREAK_MILESTONES.find((m) => m > current) ?? null;
  return {
    current,
    best,
    nextMilestone,
    toNext: nextMilestone === null ? null : nextMilestone - current,
  };
}

// ────────────────────────────────────────────────────────────── the history

export interface ChallengeHistory {
  /** Most recent first, at most five. */
  recent: { id: string; result: 'won' | 'lost' | 'drew'; opponent: string; stake: number }[];
  /** The largest single payout ever taken. 0 when there has been none. */
  biggestWin: number;
  /** Net coins across every settled challenge — CAN BE NEGATIVE, and is shown
   *  as-is. A record that only ever counts up is not a record. */
  netCoins: number;
  totalSettled: number;
}

export function challengeHistory(
  rows: readonly ForgeChallenge[],
  myId: string
): ChallengeHistory {
  const settled = rows
    .filter((c) => c.status === 'settled' && c.settled_at !== null)
    .sort((a, b) => Date.parse(String(b.settled_at)) - Date.parse(String(a.settled_at)));

  let biggestWin = 0;
  let netCoins = 0;
  const recent: ChallengeHistory['recent'] = [];

  for (const c of settled) {
    const r = myResult(c, myId);
    if (r === null) continue;
    if (r === 'won') {
      biggestWin = Math.max(biggestWin, c.stake);
      netCoins += c.stake;
    } else if (r === 'lost') {
      netCoins -= c.stake;
    }
    if (recent.length < 5) {
      // Derived from myId, NOT from `i_am_challenger`. That flag is computed
      // server-side for the CALLING user, so using it here would have made
      // the result respect myId while the name silently did not — the kind of
      // half-relative function that reads correctly until someone passes the
      // other athlete's id.
      const opponent = c.challenger_id === myId ? c.opponent_name : c.challenger_name;
      recent.push({ id: c.id, result: r, opponent, stake: c.stake });
    }
  }

  return { recent, biggestWin, netCoins, totalSettled: settled.length };
}

// ─────────────────────────────────────────────────────────────── confidence

export type ConfidenceBand =
  | 'commanding'
  | 'ahead'
  | 'even'
  | 'behind'
  | 'chasing';

export interface Confidence {
  band: ConfidenceBand;
  label: string;
  /** One line the athlete can act on. */
  note: string;
}

const BANDS: Readonly<Record<ConfidenceBand, { label: string; note: string }>> = {
  commanding: { label: 'COMMANDING LEAD', note: 'Hold it. One more session keeps this out of reach.' },
  ahead: { label: 'SLIGHT ADVANTAGE', note: 'Narrow. A single session could settle it.' },
  even: { label: 'EVEN MATCH', note: 'Nothing between you. The next session decides it.' },
  behind: { label: 'UNDERDOG', note: 'Close enough to take back. One good session.' },
  chasing: { label: 'CHASING', note: 'Behind, with time left. Every session closes the gap.' },
};

/**
 * How the contest STANDS — from the two current scores, never a forecast.
 *
 * The thresholds are relative to the leader's score so a 2-point gap means
 * something different at 5 than at 200. With nothing logged on either side it
 * is EVEN, which is the truth: nobody has done anything yet.
 */
export function confidenceOf(c: ForgeChallenge, myId: string): Confidence {
  const { me, them } = sidesOf(c);
  void myId;
  const mine = sideScore(c, me);
  const theirs = sideScore(c, them);
  const top = Math.max(Math.abs(mine), Math.abs(theirs));

  if (top === 0) return { band: 'even', ...BANDS.even };

  const gap = mine - theirs;
  const ratio = gap / top;

  let band: ConfidenceBand;
  if (ratio >= 0.4) band = 'commanding';
  else if (ratio > 0.05) band = 'ahead';
  else if (ratio >= -0.05) band = 'even';
  else if (ratio > -0.4) band = 'behind';
  else band = 'chasing';

  return { band, ...BANDS[band] };
}

/**
 * WHAT A WIN AND A LOSS ACTUALLY COST used to live here as `outcomesFor`.
 *
 * It moved to `domain/forge-duel.ts`'s AT_RISK in the 2026-08-08 duel pass,
 * where the same facts are five labelled rows instead of a paragraph. The
 * statement itself has not changed and must not: a duel moves COINS and
 * nothing else. XP, the Forge Level, the Evo Rating and every evolution
 * requirement are computed from logged training and are untouched by any
 * outcome. Losing a wager cannot make an athlete smaller.
 */
