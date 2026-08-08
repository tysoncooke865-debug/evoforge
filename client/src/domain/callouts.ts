/**
 * LIVE WORKOUT CALL OUTS — the client's vocabulary.
 *
 * Pure functions only. Nothing here decides money: migrations 150–153 own every
 * balance, every verdict and every payout, and this file describes the answer,
 * writes the sentence a human would say, and works out whether the affordance
 * should exist at all.
 *
 * That split is the security model restated. Anything here that computed a
 * RESULT would be a number the client chose, and the server would have to either
 * trust it (fatal) or ignore it (pointless). `judgeCallout` below exists only so
 * the athlete can be warned BEFORE they log — the row the server judges is the
 * one their logger writes, and 153's `callout_judge` is the arbiter.
 *
 * FORGE COINS ARE FICTIONAL. A call out moves coins and nothing else: XP, the
 * Evo Rating, the Forge Level and every physique number are computed from logged
 * training and are untouched by any outcome.
 */

import {
  formatExerciseSet,
  type CanonicalSet,
  type ExerciseLoadMode,
} from './exercise-load';
import { chipBreakdown, type ForgeChipValue } from './forge-duel';
import { isCountedSet } from './workouts';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { pyInt } from './py';
import type { WeightUnit } from './units';

// ─────────────────────────────────────────────────────────── lifecycle

export type CalloutStatus =
  | 'offered'
  | 'accepted'
  | 'awaiting_verification'
  | 'settled'
  | 'declined'
  | 'cancelled'
  | 'disputed'
  | 'expired';

export type CalloutResult = 'hit' | 'miss';

/** A call out still capable of changing — what the one-live rule counts and
 *  what the poll stays awake for. */
export const LIVE_STATUSES: readonly CalloutStatus[] = [
  'offered',
  'accepted',
  'awaiting_verification',
  'disputed',
];

export function isLive(status: CalloutStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/** Attached to a SET on the workout page: the states that make a row wear a
 *  badge. A settled one shows briefly and then stops being furniture. */
export function isAttachedToSet(status: CalloutStatus): boolean {
  return status === 'offered' || status === 'accepted' || status === 'awaiting_verification';
}

/** The shape `my_workout_callouts()` returns. Snake_case because it is the
 *  server's row, not a re-mapped copy that could drift from it. */
export interface CalloutRow {
  id: string;
  athlete_id: string;
  opponent_id: string;
  initiated_by: string;
  workout_date: string;
  workout_name: string;
  exercise: string;
  set_no: number;
  target_reps: number;
  target_load_mode: ExerciseLoadMode;
  target_weight_kg: number | null;
  target_label: string;
  stake: number;
  pot: number;
  hit_probability: number;
  odds_model_version: string;
  odds_evidence: CalloutEvidence | null;
  status: CalloutStatus;
  result: CalloutResult | null;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  actual_load_mode: string | null;
  dispute_reason: string | null;
  athlete_calloff_at: string | null;
  opponent_calloff_at: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  set_logged_at: string | null;
  verified_at: string | null;
  settled_at: string | null;
  i_am_athlete: boolean;
  athlete_name: string;
  opponent_name: string;
}

/** What "WHY THESE ODDS?" prints. Small on purpose: three or four numbers about
 *  ONE lift, which the athlete published by making the call. */
export interface CalloutEvidence {
  recent_best?: string | null;
  today?: string[] | null;
  target?: string | null;
  trend?: 'improving' | 'stable' | 'declining' | null;
  sets_seen?: number | null;
  early?: boolean | null;
}

// ───────────────────────────────────────────────────────── the config

export interface CalloutConfig {
  min_stake: number;
  max_stake: number;
  offer_minutes: number;
  attempt_hours: number;
  verify_hours: number;
  dispute_hours: number;
  reveal_min_sets: number;
}

/**
 * A first-paint fallback and NOTHING MORE. `workout_callout_config` is the
 * authority; this exists so the tray can render before the row arrives, and it
 * mirrors 150's defaults exactly. If the two ever disagree the server wins, and
 * the tray's own clamp is what keeps it from offering a stake the server would
 * refuse.
 */
export const DEFAULT_CALLOUT_CONFIG: CalloutConfig = {
  min_stake: 5,
  max_stake: 500,
  offer_minutes: 30,
  attempt_hours: 6,
  verify_hours: 48,
  dispute_hours: 72,
  reveal_min_sets: 20,
};

/** The quick rail. A subset of FORGE_CHIPS, because a gym decision is 25 / 50 /
 *  100 / 250 and seven buttons is a menu. The chip TABLE still takes any
 *  denomination — this is only what a thumb can hit without aiming. */
export const CALLOUT_QUICK_CHIPS = [25, 50, 100, 250] as const;

/**
 * THE CHIPS ON A SMALL TABLE — what a person would actually hand over.
 *
 * NOT `decompose`. That one deliberately picks the smallest denomination that
 * still FILLS a table, because a duel's 236px felt looks empty with two discs
 * on it — so it draws a 50-coin pot as ten 5s. On a 96px micro pot those ten
 * grey 5s are both illegible and wrong-coloured: 5 is the COMMON band, so the
 * card announcing fifty coins renders the cheapest chip in the set.
 *
 * At this size the minimal breakdown is the right picture: one green 50, and a
 * second arriving with a CLACK when the doubt lands. Height stops carrying the
 * money and the NUMBER beside it does, which is what a small card wants.
 */
export function potChips(amount: number, max = 8): ForgeChipValue[] {
  const out: ForgeChipValue[] = [];
  for (const { value, count } of chipBreakdown(amount)) {
    for (let i = 0; i < count && out.length < max; i += 1) out.push(value);
  }
  return out;
}

/** The largest legal stake, so no affordance can offer a refusal. */
export function maxCalloutStake(balance: number, cfg: CalloutConfig): number {
  return Math.max(0, Math.min(Math.floor(balance), cfg.max_stake));
}

export function clampCalloutStake(amount: number, balance: number, cfg: CalloutConfig): number {
  const max = maxCalloutStake(balance, cfg);
  if (max < cfg.min_stake) return 0;
  return Math.max(0, Math.min(Math.floor(amount), max));
}

// ─────────────────────────────────────────────────────── the proposition

export interface CalloutTarget {
  loadMode: ExerciseLoadMode;
  /** The PART belonging to the mode — external load, added load, or assistance.
   *  Never a computed total, and null for a mode that has no load field. */
  weightKg: number | null;
  reps: number;
}

/**
 * "100 KG × 5+" — the sentence both athletes read.
 *
 * Rendered ONCE, by the caller's client, in the caller's units, and stored on
 * the row. An opponent reading pounds and an athlete reading kilograms must
 * never be looking at two different bets, and the only way to guarantee that is
 * to send the STRING rather than re-render it on each device.
 *
 * The `+` is the whole proposition: a call is "at least this", so exceeding it
 * wins and there is no upper edge to argue about.
 */
export function calloutTargetLabel(target: CalloutTarget, unit: WeightUnit = 'kg'): string {
  const set: CanonicalSet = {
    loadMode: target.loadMode,
    weightKg: target.loadMode === 'external' ? target.weightKg : null,
    externalLoadKg: target.loadMode === 'weighted_bodyweight' ? target.weightKg : null,
    assistanceKg: target.loadMode === 'assisted_bodyweight' ? target.weightKg : null,
    assistanceType: null,
    assistanceDescription: null,
    bodyweightSnapshotKg: null,
    reps: target.reps,
    durationSeconds: null,
    distanceMeters: null,
  };
  // formatExerciseSet is the one place a set becomes words in this app; going
  // through it is what keeps "BW + 20 kg × 8" identical here and in history.
  return `${formatExerciseSet(set, unit).replace(/ reps$/, '')}+`.toUpperCase();
}

/** Can this mode carry a rep proposition at all? Duration and distance cannot —
 *  "at least 5 reps" is not a thing you can say about a plank. */
export function isCallableMode(mode: ExerciseLoadMode): boolean {
  return (
    mode === 'external' ||
    mode === 'bodyweight' ||
    mode === 'weighted_bodyweight' ||
    mode === 'assisted_bodyweight' ||
    mode === 'repetition_only'
  );
}

// ───────────────────────────────────────────────────────────── the judge

export interface CalloutActual {
  /** Null on a pre-133 database, where the row carries no mode at all. */
  loadMode: ExerciseLoadMode | null;
  /** The legacy `weight` column: external load, and 0 for bodyweight work. */
  weightKg: number | null;
  externalLoadKg?: number | null;
  assistanceKg?: number | null;
  reps: number;
}

/**
 * A MIRROR OF 153's `callout_judge`, AND NOT AN AUTHORITY.
 *
 * The server decides what was hit; this exists so the workout page can say
 * "BELOW YOUR CALL" while the athlete is still typing, which is the difference
 * between a surprise and a decision. Both are pinned by the same cases — the
 * vitest suite here and the SQL harness's section 12 — so a change to one that
 * is not made to the other fails immediately rather than eventually.
 *
 * The rule: enough reps AND at least the load that was called. Doing more always
 * counts; doing the reps lighter never does.
 */
export function judgeCallout(target: CalloutTarget, actual: CalloutActual): CalloutResult {
  const eps = 0.01;
  if ((actual.reps ?? 0) < target.reps) return 'miss';

  const mode = actual.loadMode;
  if (mode == null) {
    // PRE-133 DATABASE (production, as of 2026-08-08): only (weight, reps)
    // exist. A bodyweight or assisted call is judged on its reps, because the
    // assistance was never recorded and inventing a number for it would be
    // worse than admitting the row cannot answer that question.
    const ok =
      target.loadMode === 'bodyweight' ||
      target.loadMode === 'repetition_only' ||
      target.loadMode === 'assisted_bodyweight'
        ? true
        : (actual.weightKg ?? 0) >= (target.weightKg ?? 0) - eps;
    return ok ? 'hit' : 'miss';
  }

  switch (target.loadMode) {
    case 'external':
      return mode === 'external' && (actual.weightKg ?? 0) >= (target.weightKg ?? 0) - eps
        ? 'hit'
        : 'miss';
    case 'repetition_only':
      return 'hit';
    case 'bodyweight':
      // Adding weight to a bodyweight call is strictly harder, so it counts.
      return mode === 'bodyweight' || mode === 'weighted_bodyweight' ? 'hit' : 'miss';
    case 'weighted_bodyweight':
      return mode === 'weighted_bodyweight' &&
        (actual.externalLoadKg ?? 0) >= (target.weightKg ?? 0) - eps
        ? 'hit'
        : 'miss';
    case 'assisted_bodyweight':
      // LESS assistance is MORE work. Needing none at all is more still.
      return (mode === 'assisted_bodyweight' &&
        (actual.assistanceKg ?? 0) <= (target.weightKg ?? 0) + eps) ||
        mode === 'bodyweight' ||
        mode === 'weighted_bodyweight'
        ? 'hit'
        : 'miss';
    default:
      return 'miss';
  }
}

// ───────────────────────────────────────────────────────────── the reveal

/**
 * SHOULD THE AFFORDANCE EXIST YET?
 *
 * A REVEAL, not a progression gate (§3). Nothing is earned and nothing can take
 * it away again: the concept needs a little training behind it to mean anything
 * — "will you hit 8 at 90" is meaningless to somebody the app has never seen
 * lift — and it needs somebody to call out.
 *
 * Once it is true it stays true, because it is derived from a number that only
 * goes up.
 */
export function calloutsAvailable(input: {
  enabled: boolean;
  countedSetsEver: number;
  friendCount: number;
  cfg?: CalloutConfig;
}): boolean {
  const cfg = input.cfg ?? DEFAULT_CALLOUT_CONFIG;
  return input.enabled && input.friendCount > 0 && input.countedSetsEver >= cfg.reveal_min_sets;
}

/** How many counted sets this athlete has ever logged — the reveal's input, off
 *  rows the app already holds. No new query. */
export function countedSetsEver(rows: WorkoutRow[] | undefined): number {
  if (!rows || rows.length === 0) return 0;
  let n = 0;
  for (const r of normaliseWorkoutLog(rows)) {
    if (isCountedSet(r.weight, r.reps)) n += 1;
  }
  return n;
}

/**
 * WHICH SET WOULD A CALL ATTACH TO?
 *
 * The first working set of this exercise that has not been logged. That is the
 * set the athlete is about to do, which is the only set a call out is ever
 * about — and it is why "set 1, then set 2" rematches work with no extra UI.
 *
 * Null when every set is done: there is nothing left to call.
 */
export function nextCallableSet(loggedRows: WorkoutRow[], targetSets: number): number | null {
  const done = new Set<number>();
  for (const r of loggedRows) {
    if (isCountedSet(r.weight, r.reps)) done.add(pyInt(r.set) ?? 0);
  }
  for (let n = 1; n <= targetSets; n += 1) {
    if (!done.has(n)) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────── the words

/**
 * HOW A HUMAN WOULD SAY IT. Gym trash talk, not a financial instrument — no
 * propositions, no outcome contracts, no market positions (§11).
 */
export function calloutHeadline(c: CalloutRow): string {
  const them = (c.i_am_athlete ? c.opponent_name : c.athlete_name).toUpperCase();
  switch (c.status) {
    case 'offered':
      return c.i_am_athlete ? `WAITING ON ${them}` : `${them} CALLED IT`;
    case 'accepted':
      return c.i_am_athlete ? `${them} DOUBTS YOU` : `YOU DOUBTED ${them}`;
    case 'awaiting_verification':
      return c.i_am_athlete ? `AWAITING ${them}` : `VERIFY ${them}`;
    case 'settled':
      if (c.result === 'hit') return c.i_am_athlete ? 'CALL HIT' : `${them} HIT IT`;
      if (c.result === 'miss') return c.i_am_athlete ? 'CALL MISSED' : `${them} MISSED`;
      return 'CALLED OFF';
    case 'disputed':
      return 'DISPUTED';
    case 'declined':
      return c.i_am_athlete ? `${them} PASSED` : 'YOU PASSED';
    case 'expired':
      return c.accepted_at ? 'CALLED OFF — NOT ATTEMPTED' : 'OFFER EXPIRED';
    case 'cancelled':
      return 'CALLED OFF';
  }
}

/**
 * WHAT THE LEDGER DID TO THIS ATHLETE, from their side.
 *
 * A win reads as the POT and a loss as the STAKE, and those are deliberately
 * different quantities: they are what actually happened to the wallet at
 * settlement. The loser's coins left at ACCEPTANCE — one negative row — and
 * nothing else moves for them; the winner receives one positive row for the
 * whole escrow. Showing a win as the net (+50) would be arithmetic nobody
 * asked for and would disagree with the coin ledger screen, the duel's own
 * "you won N coins" copy, and the chips physically sliding across the table.
 *
 * Zero is a real answer — a call off and a timeout are washes.
 */
export function calloutOutcomeCoins(c: CalloutRow): number {
  if (c.status === 'settled' && c.result) {
    const iWon = c.i_am_athlete ? c.result === 'hit' : c.result === 'miss';
    return iWon ? c.pot : -c.stake;
  }
  return 0;
}

/** "100 × 4 · needed 5" — the loser's line, and the whole of the loser's
 *  experience. No punishment, no double-or-nothing. */
export function calloutResultLine(c: CalloutRow, unit: WeightUnit = 'kg'): string | null {
  if (c.actual_reps == null) return null;
  const actual = calloutTargetLabel(
    {
      loadMode: (c.actual_load_mode as ExerciseLoadMode | null) ?? c.target_load_mode,
      weightKg: c.actual_weight_kg,
      reps: c.actual_reps,
    },
    unit
  ).replace(/\+$/, '');
  return c.result === 'miss' ? `${actual} · NEEDED ${c.target_reps}` : actual;
}

/** Seconds left on whatever clock this state is running. Negative means the
 *  sweep has not caught up yet, which is a display problem and never a money
 *  one — the server decides, on its own clock. */
export function calloutSecondsLeft(c: CalloutRow, nowMs: number): number {
  const end = Date.parse(c.expires_at);
  if (!Number.isFinite(end)) return 0;
  return Math.round((end - nowMs) / 1000);
}
