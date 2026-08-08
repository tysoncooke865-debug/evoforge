/**
 * THE FORGE DUEL — the client's vocabulary for the wager economy.
 *
 * Pure functions only. Nothing here decides money: migrations 144–146 compute
 * every balance, every score and every payout from the athletes' own rows, and
 * this file describes the answer, shapes a chip pile, and formats a clock.
 *
 * That split is the whole security model, restated: anything here that computed
 * a result would be a number the CLIENT chose, and the server would have to
 * either trust it (fatal) or ignore it (pointless).
 *
 * FORGE COINS ARE FICTIONAL. They are earned by training and are not
 * purchasable, withdrawable, transferable or convertible into anything with
 * real-world value. A duel moves coins and nothing else — XP, the Evo Rating,
 * the Forge Level, the Training Arc and every physique number are computed from
 * logged training and are untouched by any outcome.
 */

// ────────────────────────────────────────────────────────────────── chips

/**
 * THE DENOMINATIONS. Seven, because a wager table needs enough to make 125
 * feel like a decision (100 + 25) and few enough to fit one row on a phone.
 */
export const FORGE_CHIPS = [5, 10, 25, 50, 100, 250, 500] as const;
export type ForgeChipValue = (typeof FORGE_CHIPS)[number];

/** Each denomination's colour, borrowed from the rarity ladder so a 500 chip
 *  reads as rare the same way a legendary item does. Never invented here —
 *  these are token names, resolved against the live theme at render. */
export const CHIP_TONE: Readonly<Record<ForgeChipValue, string>> = {
  5: 'common',
  10: 'rare',
  25: 'accent',
  50: 'success',
  100: 'legendary',
  250: 'epic',
  500: 'mythic',
};

/**
 * The PILE that represents an amount: largest denominations first, greedily.
 *
 * Greedy is exact for this ladder (every denomination divides the next but
 * for 25→50→100, which still resolves), and it is also what a person does with
 * real chips — you do not pay 100 with twenty fives.
 */
export function chipBreakdown(amount: number): { value: ForgeChipValue; count: number }[] {
  const out: { value: ForgeChipValue; count: number }[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (let i = FORGE_CHIPS.length - 1; i >= 0; i--) {
    const v = FORGE_CHIPS[i];
    const n = Math.floor(left / v);
    if (n > 0) {
      out.push({ value: v, count: n });
      left -= n * v;
    }
  }
  return out;
}

/**
 * THE PILE THAT GETS BIGGER WHEN THE POT DOES.
 *
 * The obvious implementation — draw `chipBreakdown`'s chips — is wrong, and a
 * test caught it: 2,000 is four 500s and 125 is a 100 plus a 25, so the biggest
 * pot on the table would have rendered as a SHORTER stack than a small one.
 * The minimal breakdown is the right answer for "what would I hand over"; it is
 * the wrong one for "how much is there".
 *
 * So the pile picks ONE denomination — the smallest whose count still fits the
 * rendering budget — and stacks it. A pot of 50 is ten 5s, a pot of 2,000 is
 * eight 250s: the height tracks the money within a band, and the colour tells
 * you which band. That is how a real chip stack reads.
 *
 * The pile is TEXTURE. It floors, so it can under-represent by less than one
 * chip, and it is capped so a huge pot cannot cost a hundred nodes to draw. The
 * NUMBER printed beside it is always the exact truth.
 */
export function chipPile(amount: number, max = 14): ForgeChipValue[] {
  const total = Math.floor(amount);
  if (total < FORGE_CHIPS[0]) return [];
  const unit =
    FORGE_CHIPS.find((v) => Math.ceil(total / v) <= max) ?? FORGE_CHIPS[FORGE_CHIPS.length - 1];
  const count = Math.min(max, Math.max(1, Math.floor(total / unit)));
  return Array.from({ length: count }, () => unit);
}

/**
 * HOW MANY BODIES A PHYSICS TABLE IS WORTH SIMULATING, and how few make a
 * pile. Both live here rather than in the hook because `decompose` is the only
 * thing that reads them and it is pure arithmetic about money.
 */
export const MAX_TABLE_BODIES = 60;
const MIN_TABLE_BODIES = 7;

/**
 * THE CHIPS THAT REPRESENT AN AMOUNT ON THE TABLE — and NOT the fewest of them.
 *
 * The obvious implementation is greedy largest-first, and the browser caught
 * why it is wrong: MAX on a 1,000-coin wallet produced TWO 500 chips. A
 * 2,000-coin pot rendered as two discs on an empty table while a 125-coin one
 * rendered as five. Minimal is the right answer to "what would I hand over";
 * it is the wrong answer to "show me what is on this table".
 *
 * So it picks a BASE denomination — the largest whose count still fills the
 * table — stacks that, then spends the remainder downward so the total stays
 * exact. 1,000 becomes ten 100s. 875 becomes eight 100s, a 50 and a 25. 50
 * becomes ten 5s.
 *
 * Two properties this must never lose:
 *   EXACT while it can be. Every denomination is a multiple of 5, so any
 *   multiple of 5 within the cap is represented to the coin.
 *   BOUNDED always, and it may UNDER-state but never over-state. Past the cap
 *   the pile stops growing and the NUMBER beside the table carries the rest: a
 *   simulation is not allowed to decide how much money is at stake, and it is
 *   not allowed to melt the phone either.
 */
export function decompose(
  amount: number,
  denominations: readonly ForgeChipValue[] = FORGE_CHIPS
): ForgeChipValue[] {
  const total = Math.max(0, Math.floor(amount));
  const desc = [...denominations].sort((a, b) => b - a);
  const smallest = desc[desc.length - 1];
  if (total < smallest) return [];

  // The largest base that still puts a real pile on the table, falling back to
  // the biggest denomination the amount can afford (a 5-coin stake is one
  // chip, and pretending otherwise would be a lie about the amount).
  const base =
    desc.find((v) => Math.floor(total / v) >= MIN_TABLE_BODIES)
    ?? desc.filter((v) => v <= total).pop()
    ?? smallest;

  const out: ForgeChipValue[] = [];
  let left = total;
  // Leave room for the tail so the cap is never blown by the remainder.
  const baseCount = Math.min(Math.floor(left / base), MAX_TABLE_BODIES - 6);
  for (let i = 0; i < baseCount; i++) {
    out.push(base);
    left -= base;
  }
  for (const v of desc) {
    if (v > base) continue;
    while (left >= v && out.length < MAX_TABLE_BODIES) {
      out.push(v);
      left -= v;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── the config

/**
 * Every tunable in the economy. The SERVER's copy (forge_duel_config, one row)
 * is the authority and is fetched at runtime; this is the shape and the
 * fallback for a first paint or an offline start.
 *
 * Tune the live values with SQL against forge_duel_config — no deploy needed.
 */
export interface DuelConfig {
  min_stake: number;
  max_stake: number;
  max_wallet_pct: number;
  max_raises: number;
  max_raise: number;
  max_support: number;
  support_close_pct: number;
  support_rake_bp: number;
  invite_expiry_hours: number;
  offer_expiry_hours: number;
  max_open_duels: number;
}

export const DEFAULT_DUEL_CONFIG: DuelConfig = {
  min_stake: 5,
  max_stake: 2000,
  max_wallet_pct: 100,
  max_raises: 6,
  max_raise: 1000,
  max_support: 500,
  support_close_pct: 50,
  support_rake_bp: 0,
  invite_expiry_hours: 48,
  offer_expiry_hours: 24,
  max_open_duels: 12,
};

// ───────────────────────────────────────────────────────────────── offers

export type OfferKind = 'raise' | 'all_in' | 'counter_stake';
export type OfferStatus =
  | 'pending' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'withdrawn';

/** The one live proposal on a duel, as `my_forge_challenges` shapes it. */
export interface DuelOffer {
  id: string;
  kind: OfferKind;
  amount: number;
  proposer_id: string;
  /** True when I am the one waiting for an answer. */
  mine: boolean;
  created_at: string;
  expires_at: string;
  counter_of: string | null;
  pot_if_accepted: number;
}

export interface RaiseState {
  unlocked: boolean;
  reason: 'ready' | 'needs_session' | 'max_raises' | 'not_active';
  waiting_on?: string;
  waiting_on_name?: string;
  max_raises?: number;
}

/** The one line the UI prints under a locked RAISE button. */
export function raiseLockCopy(state: RaiseState | null, myName: string): string {
  if (!state || state.unlocked) return '';
  if (state.reason === 'max_raises') return `This duel has used all ${state.max_raises} raises.`;
  if (state.reason === 'not_active') return 'Raising opens once the duel is running.';
  const who = state.waiting_on_name ?? 'your rival';
  return `Unlocks after ${who === myName ? 'you log' : `${who} logs`} another qualifying session.`;
}

// ────────────────────────────────────────────────────────────── the clock

/** "2D 14H" · "5H 42M" · "12M" · "ENDED". Never seconds — a 7-day duel
 *  counting seconds is a stopwatch pretending to be tension. */
export function countdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return 'ENDED';
  const mins = Math.floor(msRemaining / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}D ${hours}H`;
  if (hours > 0) return `${hours}H ${m}M`;
  return `${Math.max(1, m)}M`;
}

/** How urgent the clock reads. Drives colour, never content. */
export type Urgency = 'calm' | 'soon' | 'final';
export function urgencyOf(msRemaining: number): Urgency {
  if (msRemaining <= 0) return 'final';
  if (msRemaining < 6 * 3_600_000) return 'final';
  if (msRemaining < 36 * 3_600_000) return 'soon';
  return 'calm';
}

// ──────────────────────────────────────────────────────────── supporters

export interface SupportSplit {
  /** 0–100, rounded, and the two ALWAYS sum to 100 when there is any money. */
  challengerPct: number;
  opponentPct: number;
  total: number;
}

/**
 * The sentiment meter. With nothing staked it is an even 50/50, which is the
 * honest picture of "nobody has an opinion yet" — not a 0/0 bar that reads as
 * broken.
 */
export function supportSplit(challenger: number, opponent: number): SupportSplit {
  const total = Math.max(0, challenger) + Math.max(0, opponent);
  if (total <= 0) return { challengerPct: 50, opponentPct: 50, total: 0 };
  const challengerPct = Math.round((challenger / total) * 100);
  return { challengerPct, opponentPct: 100 - challengerPct, total };
}

/**
 * WHAT A SUPPORTER WOULD TAKE, pari-mutuel, if the duel ended as it stands.
 *
 * Shown as an ESTIMATE and labelled as one, because the pools move until
 * support closes. The server recomputes it at settlement and its number is the
 * one that pays.
 */
export function estimateSupportReturn(
  stake: number,
  myPool: number,
  otherPool: number,
  rakeBp = 0
): number {
  if (stake <= 0 || myPool <= 0) return 0;
  const distributable = Math.max(0, otherPool - Math.floor((otherPool * rakeBp) / 10_000));
  return stake + Math.floor((stake * distributable) / myPool);
}

// ───────────────────────────────────────────────────────────── the timeline

export type DuelEventKind =
  | 'created' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'disputed' | 'settled'
  | 'counter_stake_proposed' | 'counter_stake_accepted' | 'counter_stake_declined'
  | 'raise_proposed' | 'raise_accepted' | 'raise_declined' | 'raise_withdrawn' | 'raise_expired'
  | 'all_in_proposed' | 'all_in_accepted' | 'all_in_declined'
  | 'workout_logged' | 'lead_change' | 'personal_record'
  | 'support_placed' | 'support_closed' | 'support_settled'
  | 'reaction';

export interface DuelEvent {
  id: string;
  kind: DuelEventKind;
  created_at: string;
  actor_id: string | null;
  actor_name: string;
  detail: Record<string, unknown>;
}

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === 'number' ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
};

/**
 * One line per event, in the athlete's language.
 *
 * Deliberately terse. A duel timeline is a scoreboard's margin note, not a
 * chat log — the brief's rule ("Do not turn it into a social messaging app"),
 * and the reason a whole session reads as one line.
 */
export function describeEvent(e: DuelEvent, names: { me: string; myId: string }): string {
  const who = e.actor_id === names.myId ? 'You' : e.actor_name;
  const amount = num(e.detail, 'amount');
  const pot = num(e.detail, 'pot') ?? num(e.detail, 'pot_if_accepted');
  const value = num(e.detail, 'value');
  const unit = typeof e.detail.unit === 'string' ? e.detail.unit : '';
  switch (e.kind) {
    case 'created': return `${who} sent the challenge`;
    case 'accepted': return `Accepted — ${pot ?? 0} in the pot`;
    case 'declined': return `${who} declined`;
    case 'cancelled': return 'Cancelled — every stake refunded';
    case 'expired': return 'The invite expired';
    case 'disputed': return `${who} raised a dispute`;
    case 'counter_stake_proposed': return `${who} countered at ${amount}`;
    case 'counter_stake_accepted': return `Stake agreed at ${amount}`;
    case 'counter_stake_declined': return `${who} declined the counter`;
    case 'raise_proposed': return `${who} proposed +${amount} each`;
    case 'raise_accepted': return `Raise accepted — pot ${pot}`;
    case 'raise_declined': return `${who} declined the raise`;
    case 'raise_withdrawn': return `${who} withdrew the offer`;
    case 'raise_expired': return 'A raise offer expired';
    case 'all_in_proposed': return `${who} went ALL IN — ${amount}`;
    case 'all_in_accepted': return `ALL IN matched — pot ${pot}`;
    case 'all_in_declined': return `${who} declined the all-in`;
    case 'workout_logged':
      return value === null ? `${who} logged a session` : `${who} logged a session — ${value}${unit ? ` ${unit}` : ''}`;
    case 'lead_change': {
      const leader = e.detail.leader_id;
      if (!leader) return 'Level — nothing between them';
      return leader === names.myId ? 'You took the lead' : `${e.actor_name} took the lead`;
    }
    case 'personal_record': return `${who} hit a new best — ${value}${unit ? ` ${unit}` : ''}`;
    case 'support_placed': return `${who} backed a side`;
    case 'support_closed': return 'Support closed';
    case 'support_settled': return 'Supporters paid';
    case 'settled': {
      const outcome = e.detail.outcome;
      if (outcome === 'draw') return `A draw — ${pot} refunded`;
      return e.detail.winner_id === names.myId ? `You won ${pot}` : `The pot went to ${pot ? '' : ''}the winner`;
    }
    default: return e.kind.replace(/_/g, ' ');
  }
}

/** The dot colour for a timeline row: news, money, or neither. */
export function eventTone(kind: DuelEventKind): 'money' | 'lead' | 'training' | 'quiet' {
  if (kind === 'lead_change' || kind === 'personal_record' || kind === 'settled') return 'lead';
  if (kind.startsWith('raise') || kind.startsWith('all_in') || kind.startsWith('counter')
      || kind.startsWith('support') || kind === 'accepted' || kind === 'cancelled') return 'money';
  if (kind === 'workout_logged') return 'training';
  return 'quiet';
}

// ────────────────────────────────────────────────────────────── rivalry

export interface Rivalry {
  other_id: string;
  other_name: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  streak: number;
  biggest_pot: number;
  net_coins: number;
  recent: { id: string; result: 'won' | 'lost' | 'drew'; pot: number; settled_at: string }[];
}

// ──────────────────────────────────────────────────────── spectator shapes

export interface WatchableDuel {
  id: string;
  challenge_type: string;
  metric_key: string | null;
  status: string;
  ends_at: string;
  support_closes_at: string | null;
  pot: number;
  challenger_id: string;
  opponent_id: string;
  leader_id: string | null;
  challenger_name: string;
  opponent_name: string;
  supporter_count: number;
  my_backed_id: string | null;
}

export interface SpectatorDuel {
  id: string;
  challenge_type: string;
  metric_key: string | null;
  duration_days: number;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  settled_at: string | null;
  support_closes_at: string | null;
  challenger_id: string;
  opponent_id: string;
  challenger_name: string;
  opponent_name: string;
  challenger_baseline: number | null;
  opponent_baseline: number | null;
  challenger_current: { value: number; unit?: string } | null;
  opponent_current: { value: number; unit?: string } | null;
  leader_id: string | null;
  winner_id: string | null;
  outcome: string | null;
  pot: number;
  support_challenger: number;
  support_opponent: number;
  supporter_count: number;
  my_support: { backed_id: string; amount: number; payout: number | null; settled_at: string | null } | null;
  my_reactions: string[];
  reactions: Record<string, number>;
  i_am_participant: boolean;
}

// ───────────────────────────────────────────────────────────── reactions

/** Five, fixed. A closed vocabulary needs no moderation and cannot carry a
 *  message — which is what keeps this a reaction and not a chat. */
export const DUEL_REACTIONS = [
  { key: 'fire', glyph: '🔥', label: 'Fire' },
  { key: 'skull', glyph: '💀', label: 'Brutal' },
  { key: 'swords', glyph: '⚔️', label: 'Duel' },
  { key: 'eyes', glyph: '👀', label: 'Watching' },
  { key: 'flex', glyph: '💪', label: 'Strong' },
] as const;
export type DuelReactionKey = (typeof DUEL_REACTIONS)[number]['key'];

// ──────────────────────────────────────────────────────── what is at risk

/**
 * THE WALL OF TEXT, REPLACED.
 *
 * The old copy was a paragraph ("A draw refunds both stakes in full. Nothing
 * else is at risk…"). It was true and nobody read it. The same facts as four
 * labelled rows are scannable in a second, and the detailed version still
 * lives behind CHALLENGE RULES for anyone who wants it.
 */
export const AT_RISK: readonly { k: string; v: string; safe: boolean }[] = [
  { k: 'DRAW', v: 'Stake refunded', safe: true },
  { k: 'XP', v: 'Safe', safe: true },
  { k: 'EVO RATING', v: 'Safe', safe: true },
  { k: 'FORGE LEVEL', v: 'Safe', safe: true },
  { k: 'TRAINING ARC', v: 'Safe', safe: true },
];

// ─────────────────────────────────────────────────────────────── numbers

/** "1,284" — grouped, so a four-figure pot is legible at a glance. */
export function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * "2 days" · "1 day" · "30 min" · "82.5 kg".
 *
 * A scoreline that reads "1 days" is the kind of thing an athlete notices
 * before they notice anything else on the card, and it makes every other
 * number on it look less carefully checked. Only `days` inflects; `min` and
 * `kg` are already unit abbreviations and do not.
 */
export function unitLabel(value: number, unit: string): string {
  if (unit === 'days') return `${value} ${Math.abs(value) === 1 ? 'day' : 'days'}`;
  return `${value} ${unit}`;
}

/**
 * The quick buttons above the chip tray. MAX is the largest LEGAL stake given
 * the wallet, the configured ceiling and the wallet-percentage cap — computed
 * here so the button can never offer an amount the server would refuse.
 */
export function maxStakeFor(balance: number, cfg: DuelConfig, opponentBalance?: number): number {
  const byWallet = Math.floor((balance * cfg.max_wallet_pct) / 100);
  const limits = [balance, byWallet, cfg.max_stake];
  // A stake the opponent cannot cover is an invite that can never be accepted.
  if (typeof opponentBalance === 'number') limits.push(opponentBalance);
  return Math.max(0, Math.min(...limits));
}

/** Round a proposed stake down to something the server will accept. */
export function clampStake(amount: number, balance: number, cfg: DuelConfig, opponentBalance?: number): number {
  const max = maxStakeFor(balance, cfg, opponentBalance);
  if (max < cfg.min_stake) return 0;
  return Math.min(Math.max(Math.floor(amount), 0), max);
}
