/**
 * FORGE CHALLENGES — the client's shared vocabulary and the pure bits of
 * presentation. It does NOT decide winners: migrations 139–142 do that, from
 * the athletes' own logged rows, and this file only describes the answer.
 *
 * That split is the whole security model. Anything here that computed a
 * result would be a number the client chose, and the server would have to
 * either trust it (fatal) or ignore it (pointless). So: formatting, labels,
 * rules copy, and the leader/progress derivations that are honest restatements
 * of what the server already returned.
 */

import { unitLabel, type DuelOffer, type RaiseState } from './forge-duel';

export const CHALLENGE_TYPES = ['most_improved_lift', 'training_consistency', 'cardio_minutes'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/**
 * THE DURATIONS ON OFFER. 3 days exists because a first duel that resolves
 * this week is how somebody learns the loop; 30 because a training block is a
 * real unit. The server accepts 1–30, so this list is a product choice and can
 * grow without a migration.
 */
export const CHALLENGE_DURATIONS = [3, 7, 14, 30] as const;
export type ChallengeDuration = number;

/**
 * A STAKE IS A NUMBER NOW, not one of three buttons.
 *
 * 139 pinned it to (10, 25, 50) because the UI had three choices. The wager
 * table has seven chip denominations and a running total, so the range is the
 * contract instead — bounded by `forge_duel_config` on the server, which is
 * the only copy that decides anything (see domain/forge-duel.ts).
 */
export type ChallengeStake = number;

/** The one lift the MVP supports — it must match the exercise library name
 *  exactly, because the server scores by string equality on workout_log. */
export const DEFAULT_LIFT = 'Barbell Bench Press (Strength)';

export type ChallengeStatus =
  | 'pending'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'active'
  | 'awaiting_settlement'
  | 'disputed'
  | 'settled';

/** One athlete's live or final numbers, exactly as the server shaped them. */
export interface ChallengeSide {
  value: number;
  unit?: string;
  measured?: boolean;
  scheduled?: number;
}

/** A row of `my_forge_challenges()`. Field names mirror the SQL. */
export interface ForgeChallenge {
  id: string;
  challenge_type: ChallengeType;
  metric_key: string | null;
  duration_days: number;
  /** The OPENING stake, locked at acceptance. `current_stake` is the live one. */
  stake: number;
  status: ChallengeStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  settled_at: string | null;
  winner_id: string | null;
  outcome: 'winner' | 'draw' | 'refund' | null;
  result_note: string | null;
  rematch_of: string | null;
  challenger_id: string;
  opponent_id: string;
  i_am_challenger: boolean;
  challenger_name: string;
  opponent_name: string;
  challenger_baseline: number | null;
  opponent_baseline: number | null;
  challenger_current: ChallengeSide | null;
  opponent_current: ChallengeSide | null;
  disputed: boolean;

  // ── 144: the live economy ──────────────────────────────────────────────
  /** Per athlete, after every accepted raise. The pot is always twice this. */
  current_stake: number;
  pot: number;
  raises_accepted: number;
  last_raise_at: string | null;
  /** Who is ahead as of the last qualifying session, stored server-side so a
   *  lead CHANGE can be an event with a moment rather than a diff nobody saw. */
  leader_id: string | null;
  support_closes_at: string | null;
  spectators_enabled: boolean;
  /** What each athlete actually has at risk — grows with raises. */
  challenger_escrowed: number;
  opponent_escrowed: number;
  challenger_last_session: string | null;
  opponent_last_session: string | null;
  /** The ONE live proposal, or null. */
  pending_offer: DuelOffer | null;
  raise_state: RaiseState | null;
  support_challenger: number;
  support_opponent: number;
  supporter_count: number;
}

// ─────────────────────────────────────────────────────────────── the rules

export interface ChallengeTypeInfo {
  key: ChallengeType;
  name: string;
  /** One line, for the picker. */
  tagline: string;
  measures: string;
  winner: string;
  counts: string[];
  doesNotCount: string[];
  unit: string;
}

/**
 * WHAT THE ATHLETE IS AGREEING TO. Shown in full before a challenge is sent
 * AND before it is accepted — "the exact definition must be shown before
 * accepting", and a wager whose rules you learn afterwards is a trick.
 */
export const CHALLENGE_INFO: Readonly<Record<ChallengeType, ChallengeTypeInfo>> = {
  most_improved_lift: {
    key: 'most_improved_lift',
    name: 'MOST IMPROVED LIFT',
    tagline: 'Who adds the most to their bench',
    measures: 'Your best estimated 1RM for the Barbell Bench Press.',
    winner:
      'The larger PERCENTAGE improvement over your own starting 1RM wins — so a lighter athlete is not punished for having less weight to add.',
    counts: [
      'Bench press sets logged during the challenge',
      'Your best single estimated 1RM in the window',
      'Your starting 1RM, snapshotted the moment the challenge begins',
    ],
    doesNotCount: [
      'Sets logged before the challenge started',
      'Other exercises',
      '0 kg sets — they cannot be a 1RM',
    ],
    unit: 'kg',
  },
  training_consistency: {
    key: 'training_consistency',
    name: 'TRAINING CONSISTENCY',
    tagline: 'Who trains on more days',
    measures: 'Days you completed training during the challenge.',
    winner:
      'More completed training days wins. Judged on DAYS, not on your schedule, so two athletes with different plans are compared on the same scale.',
    counts: [
      'A day with at least one logged set',
      'A day with a cardio session',
      'A day you explicitly finished a workout',
    ],
    doesNotCount: [
      'An abandoned workout with nothing logged',
      'The same day twice, however much you train in it',
      'Days outside the challenge window',
    ],
    unit: 'days',
  },
  cardio_minutes: {
    key: 'cardio_minutes',
    name: 'CARDIO MINUTES',
    tagline: 'Who logs more cardio',
    measures: 'Total cardio minutes logged during the challenge.',
    winner: 'The higher total wins.',
    counts: ['Every cardio session logged in the window', 'Any activity type'],
    doesNotCount: ['Sessions dated outside the window', 'Zero-minute entries'],
    unit: 'min',
  },
};

// ───────────────────────────────────────────────────── derived presentation

/** The score the server compares — restated so the UI can show it, never to
 *  decide anything. Percentage for a lift, the raw count otherwise. */
export function sideScore(c: ForgeChallenge, side: 'challenger' | 'opponent'): number {
  const current = side === 'challenger' ? c.challenger_current : c.opponent_current;
  const baseline = side === 'challenger' ? c.challenger_baseline : c.opponent_baseline;
  if (c.challenge_type !== 'most_improved_lift') return current?.value ?? 0;
  if (baseline === null || baseline <= 0 || !current) return 0;
  return Math.round(((current.value - baseline) / baseline) * 100 * 10) / 10;
}

/** How a side's number reads: "+7.9%" for a lift, "5 days" otherwise. */
export function sideLabel(c: ForgeChallenge, side: 'challenger' | 'opponent'): string {
  const info = CHALLENGE_INFO[c.challenge_type];
  const score = sideScore(c, side);
  if (c.challenge_type === 'most_improved_lift') {
    return `${score > 0 ? '+' : ''}${score.toFixed(1)}%`;
  }
  return unitLabel(score, info.unit);
}

export type Leader = 'challenger' | 'opponent' | 'tied';

export function leaderOf(c: ForgeChallenge): Leader {
  const a = sideScore(c, 'challenger');
  const b = sideScore(c, 'opponent');
  if (a > b) return 'challenger';
  if (b > a) return 'opponent';
  return 'tied';
}

/** "DAY 8 OF 14" — 1-based, clamped, and never past the end. */
export function challengeDay(c: ForgeChallenge, nowIso: string): { day: number; of: number } {
  const of = c.duration_days;
  if (!c.starts_at) return { day: 0, of };
  const start = Date.parse(c.starts_at);
  const now = Date.parse(`${nowIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return { day: 0, of };
  const elapsed = Math.floor((now - start) / 86_400_000);
  return { day: Math.min(of, Math.max(1, elapsed + 1)), of };
}

/** 0..1 through the window, for the progress rail. */
export function challengeProgress(c: ForgeChallenge, nowIso: string): number {
  const { day, of } = challengeDay(c, nowIso);
  return of <= 0 ? 0 : Math.min(1, Math.max(0, day / of));
}

/** Did I win, lose or draw? Null when it has not settled. */
export function myResult(c: ForgeChallenge, myId: string): 'won' | 'lost' | 'drew' | null {
  if (c.status !== 'settled') return null;
  if (c.outcome === 'draw' || c.winner_id === null) return 'drew';
  return c.winner_id === myId ? 'won' : 'lost';
}

/**
 * Coins this challenge moved FOR ME.
 *
 * Measured against what was ACTUALLY ESCROWED, not the opening stake: a duel
 * raised from 25 to 60 wins or loses 60. A draw returns the escrow, so it is 0
 * net — never shown as a loss.
 */
export function myCoinDelta(c: ForgeChallenge, myId: string): number {
  const r = myResult(c, myId);
  const at = myEscrow(c, myId);
  if (r === 'won') return at;
  if (r === 'lost') return -at;
  return 0;
}

/** What I have at risk in this duel, raises included. */
export function myEscrow(c: ForgeChallenge, myId: string): number {
  const mine = c.challenger_id === myId ? c.challenger_escrowed : c.opponent_escrowed;
  // Before acceptance nothing is escrowed, and the honest answer is the stake
  // it WOULD cost — that is the number the invite is asking about.
  return mine > 0 ? mine : (c.current_stake ?? c.stake);
}

/** The live pot. Derived from current_stake so it can never disagree with the
 *  escrow the server actually holds. */
export function potOf(c: ForgeChallenge): number {
  return c.pot ?? (c.current_stake ?? c.stake) * 2;
}

/** Milliseconds left in the window; 0 once it has closed. */
export function msRemaining(c: ForgeChallenge, nowMs: number): number {
  if (!c.ends_at) return 0;
  return Math.max(0, Date.parse(c.ends_at) - nowMs);
}

/** Milliseconds until a pending INVITE dies unanswered. */
export function msToExpiry(c: ForgeChallenge, nowMs: number): number {
  return Math.max(0, Date.parse(c.expires_at) - nowMs);
}

/** Is spectator backing still open on this duel? */
export function supportOpen(c: ForgeChallenge, nowMs: number): boolean {
  if (c.status !== 'active' || !c.spectators_enabled) return false;
  if (!c.support_closes_at) return false;
  return Date.parse(c.support_closes_at) > nowMs;
}

/** Am I ahead, behind, or level — from the server's stored leader while it is
 *  live, and from the winner once it has settled. */
export function myStanding(c: ForgeChallenge, myId: string): 'leading' | 'trailing' | 'level' {
  const leader = c.status === 'settled' ? c.winner_id : c.leader_id;
  if (!leader) return 'level';
  return leader === myId ? 'leading' : 'trailing';
}

export interface ChallengeRecord {
  wins: number;
  losses: number;
  draws: number;
  coinsWon: number;
}

/**
 * The athlete's lifetime record. Losses are counted, not dwelt on — the brief
 * asks for an honest tally, not a scoreboard that shames.
 */
export function challengeRecord(rows: readonly ForgeChallenge[], myId: string): ChallengeRecord {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let coinsWon = 0;
  for (const c of rows) {
    const r = myResult(c, myId);
    // The ESCROW, not the opening stake: a duel raised to 60 won 60.
    if (r === 'won') { wins += 1; coinsWon += myEscrow(c, myId); }
    else if (r === 'lost') losses += 1;
    else if (r === 'drew') draws += 1;
  }
  return { wins, losses, draws, coinsWon };
}

/** The buckets the Challenges hub renders, in priority order. */
export interface ChallengeBuckets {
  incoming: ForgeChallenge[];
  active: ForgeChallenge[];
  sent: ForgeChallenge[];
  finished: ForgeChallenge[];
}

export function bucketChallenges(rows: readonly ForgeChallenge[], myId: string): ChallengeBuckets {
  const incoming: ForgeChallenge[] = [];
  const active: ForgeChallenge[] = [];
  const sent: ForgeChallenge[] = [];
  const finished: ForgeChallenge[] = [];
  for (const c of rows) {
    if (c.status === 'active' || c.status === 'awaiting_settlement' || c.status === 'disputed') active.push(c);
    else if (c.status === 'pending') (c.opponent_id === myId ? incoming : sent).push(c);
    else finished.push(c);
  }
  return { incoming, active, sent, finished };
}

/** Is this pending invite still alive? An expired one must not be acceptable. */
export function isExpired(c: ForgeChallenge, nowMs: number): boolean {
  return c.status === 'pending' && Date.parse(c.expires_at) <= nowMs;
}

/** Can this challenge be settled now — window closed, nothing disputed? */
export function isSettleable(c: ForgeChallenge, nowMs: number): boolean {
  if (c.status !== 'active' && c.status !== 'awaiting_settlement') return false;
  if (c.disputed) return false;
  return c.ends_at !== null && Date.parse(c.ends_at) <= nowMs;
}

/** Whose name is on which side, from my point of view. */
export function sidesOf(c: ForgeChallenge): {
  me: 'challenger' | 'opponent';
  them: 'challenger' | 'opponent';
  myName: string;
  theirName: string;
  theirId: string;
} {
  return c.i_am_challenger
    ? { me: 'challenger', them: 'opponent', myName: c.challenger_name, theirName: c.opponent_name, theirId: c.opponent_id }
    : { me: 'opponent', them: 'challenger', myName: c.opponent_name, theirName: c.challenger_name, theirId: c.challenger_id };
}

/** The pot at stake in a settled duel, for a history row. */
export function settledPot(c: ForgeChallenge): number {
  return (c.challenger_escrowed || 0) + (c.opponent_escrowed || 0) || potOf(c);
}

export const STATUS_LABEL: Readonly<Record<ChallengeStatus, string>> = {
  pending: 'AWAITING REPLY',
  declined: 'DECLINED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED · REFUNDED',
  active: 'IN PROGRESS',
  awaiting_settlement: 'READY TO SETTLE',
  disputed: 'PAUSED · DISPUTED',
  settled: 'COMPLETE',
};

/** The safety line, shown wherever a challenge is agreed to. Non-negotiable:
 *  a wager must never read as an instruction to attempt an unsafe max. */
export const SAFETY_NOTE =
  'Results are calculated from your logged EvoForge training. Do not perform unsafe max attempts for a challenge.';
