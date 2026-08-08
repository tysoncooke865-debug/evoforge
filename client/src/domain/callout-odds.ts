/**
 * EVO ODDS — will this athlete hit this set?
 *
 * Deterministic and explainable, from rows the app already holds. No new query,
 * no model file, no service: `workout_log` is in the cache because the logging
 * screen needs it, and every number below is derived from it.
 *
 * FOUR THINGS THIS DELIBERATELY IS NOT:
 *
 * 1. **Precise.** A gym set is not a coin with a known bias. The output is
 *    clamped to 10–90% however strong the evidence looks, because "99.8%" about
 *    a human being under a barbell is a number that deserves to be disbelieved,
 *    and one confident miss would poison every honest estimate after it.
 * 2. **The payout.** V1 stakes are equal and matched: 50 against 50, winner
 *    takes 100. The odds are context, hype and a foundation — not a price. That
 *    is also why a tampered client can distort the display and nothing else.
 * 3. **A score the athlete can grind.** There is no confidence progression, no
 *    unlock and no user-facing accuracy metric. Weak evidence says EARLY
 *    ESTIMATE and shrinks toward 50%, which is what weak evidence means.
 * 4. **Shared.** The opponent cannot read the athlete's log — RLS forbids it —
 *    so this runs on the ATHLETE's device and the answer is snapshotted onto the
 *    call out at creation. What the opponent sees is what the athlete's app
 *    computed, frozen, along with the handful of numbers that produced it.
 */

import { recencyWeight, daysBetween, evidenceConfidence } from './progression/confidence';
import { pyFloat, pyInt } from './py';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { displayWeight, type WeightUnit } from './units';
import { estimated1rm, isCountedSet } from './workouts';
import { calloutTargetLabel, judgeCallout, type CalloutEvidence, type CalloutTarget } from './callouts';

export const ODDS_MODEL_VERSION = 'callout-odds-v1';

/** The floor and ceiling. Never widened without a reason written down. */
export const ODDS_MIN = 0.1;
export const ODDS_MAX = 0.9;

/** Below this many counted sets on the lift, the estimate says so out loud. */
const EARLY_SET_COUNT = 3;
/** …and so does a lift the athlete has not touched in this many days. */
const EARLY_STALE_DAYS = 60;

/**
 * How sharply the ratio turns into a probability. 9 gives 50% at parity, ~71%
 * at 10% headroom and ~29% at 10% short — steep enough to be interesting,
 * shallow enough that a 2% margin is not treated as certainty.
 */
const K = 9;

/** Each set already done today on this lift costs a little, capped. Fatigue is
 *  real and it is not linear all the way down. */
const FATIGUE_PER_SET = 0.025;
const FATIGUE_MAX = 0.12;

/** Having already met this exact call today. Not certainty — a fifth set is
 *  harder than a first — but well past a coin flip. */
const PROVED_TODAY_FLOOR = 0.72;

export interface CallOdds {
  hitProbability: number;
  missProbability: number;
  /** Sparse or stale history: show EARLY ESTIMATE and mean it. */
  early: boolean;
  trend: 'improving' | 'stable' | 'declining' | null;
  evidence: CalloutEvidence;
  modelVersion: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

interface Perf {
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
  ageDays: number;
}

/** This lift's counted history, newest first, with each row's age. */
function history(rows: WorkoutRow[] | undefined, exercise: string, todayIso: string): Perf[] {
  if (!rows || rows.length === 0) return [];
  const key = exercise.trim().toLowerCase();
  const out: Perf[] = [];
  for (const r of normaliseWorkoutLog(rows)) {
    if (String(r.exercise ?? '').trim().toLowerCase() !== key) continue;
    if (!isCountedSet(r.weight, r.reps)) continue;
    const weight = pyFloat(r.weight) ?? 0;
    const reps = pyInt(r.reps) ?? 0;
    const date = String(r.date ?? '');
    out.push({
      date,
      weight,
      reps,
      e1rm: estimated1rm(weight, reps),
      ageDays: daysBetween(date, todayIso),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * IMPROVING, STABLE OR DECLINING — the newest three sessions against the three
 * before them. Null until there are enough sessions for the comparison to mean
 * anything; a trend drawn from two data points is a rumour.
 */
function trendOf(perf: Perf[]): CallOdds['trend'] {
  const byDate = new Map<string, number>();
  for (const p of perf) byDate.set(p.date, Math.max(byDate.get(p.date) ?? 0, p.e1rm));
  const days = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  if (days.length < 4) return null;
  const recent = days.slice(0, 3).map((d) => d[1]);
  const prior = days.slice(3, 6).map((d) => d[1]);
  if (prior.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const a = mean(recent);
  const b = mean(prior);
  if (b <= 0) return null;
  const delta = (a - b) / b;
  if (delta > 0.03) return 'improving';
  if (delta < -0.03) return 'declining';
  return 'stable';
}

/**
 * THE ESTIMATE.
 *
 * `capacity / demand` is the whole model. For a loaded call both sides are an
 * estimated 1RM; for a bodyweight or assisted one there is no honest kilogram
 * to build an e1RM from — legacy rows store 0 kg by design — so the comparison
 * is REPS AGAINST REPS at a comparable load. Two shapes, one ratio, and neither
 * of them invents a bodyweight.
 */
export function estimateCallOdds(input: {
  rows: WorkoutRow[] | undefined;
  exercise: string;
  target: CalloutTarget;
  todayIso: string;
  unit?: WeightUnit;
}): CallOdds {
  const { rows, exercise, target, todayIso, unit = 'kg' } = input;
  const perf = history(rows, exercise, todayIso);
  const priorToday = perf.filter((p) => p.date === todayIso);
  const past = perf.filter((p) => p.date !== todayIso);
  const seen = perf.filter((p) => p.ageDays <= 90).length;
  const newestAge = perf.length > 0 ? perf[0].ageDays : Number.POSITIVE_INFINITY;

  const loadBased = target.loadMode === 'external' || target.loadMode === 'weighted_bodyweight';

  // ── capacity ─────────────────────────────────────────────────────────────
  let ratio: number | null = null;
  if (loadBased) {
    const demand = estimated1rm(target.weightKg ?? 0, target.reps);
    let capacity = 0;
    for (const p of perf) capacity = Math.max(capacity, p.e1rm * recencyWeight(p.ageDays));
    if (demand > 0 && capacity > 0) ratio = capacity / demand;
  } else {
    // Reps against reps, at a load no lighter than the one being called.
    const floorKg = (target.weightKg ?? 0) - 0.01;
    let best = 0;
    for (const p of perf) {
      if (p.weight + 0.01 < floorKg) continue;
      best = Math.max(best, p.reps * recencyWeight(p.ageDays));
    }
    if (target.reps > 0 && best > 0) ratio = best / target.reps;
  }

  // ── today ────────────────────────────────────────────────────────────────
  const fatigue = 1 - Math.min(FATIGUE_MAX, FATIGUE_PER_SET * priorToday.length);
  // A set TODAY that already met the call is the strongest evidence there is —
  // the athlete has done this exact thing, in this session, under this fatigue.
  const provedToday = priorToday.some(
    (p) => judgeCallout(target, { loadMode: null, weightKg: p.weight, reps: p.reps }) === 'hit'
  );

  // ── probability ──────────────────────────────────────────────────────────
  let p: number;
  if (ratio === null) {
    // Never done, or never done at a comparable load. That is not 50% because
    // we know something — it is 50% because we know nothing, which is the same
    // number for a different and more honest reason.
    p = 0.5;
  } else {
    p = logistic(K * (ratio * fatigue - 1));
  }
  const trend = trendOf(past);
  if (trend === 'improving') p += 0.03;
  if (trend === 'declining') p -= 0.03;

  // ── confidence shrink ────────────────────────────────────────────────────
  // Weak or stale evidence pulls the answer toward the middle rather than
  // pretending. Nothing here is shown to the athlete as a score.
  const conf = (evidenceConfidence(seen, { base: 25, max: 95, perItem: 0.3 }) / 100) *
    recencyWeight(newestAge);
  let shrunk = 0.5 + (p - 0.5) * conf;

  // THE FLOOR GOES ON AFTER THE SHRINK, and that ordering is the whole point.
  // The shrink exists because INFERRING from other loads and other days is
  // uncertain. Having already met this exact call, today, in this session, is
  // not an inference — it is the thing itself, and discounting it for thin
  // history would be the model doubting evidence it can see.
  if (provedToday) shrunk = Math.max(shrunk, PROVED_TODAY_FLOOR);
  const hit = Math.round(clamp(shrunk, ODDS_MIN, ODDS_MAX) * 100) / 100;

  // ── the receipt ──────────────────────────────────────────────────────────
  const bestPast = past.reduce<Perf | null>((b, x) => (b === null || x.e1rm > b.e1rm ? x : b), null);
  const say = (x: Perf) =>
    x.weight === 0 ? `BW × ${x.reps}` : `${displayWeight(x.weight, unit)} ${unit} × ${x.reps}`;
  const evidence: CalloutEvidence = {
    recent_best: bestPast ? say(bestPast) : null,
    today: priorToday.length > 0 ? priorToday.map(say) : null,
    target: calloutTargetLabel(target, unit),
    trend,
    sets_seen: seen,
    early: seen < EARLY_SET_COUNT || newestAge > EARLY_STALE_DAYS,
  };

  return {
    hitProbability: hit,
    missProbability: Math.round((1 - hit) * 100) / 100,
    early: Boolean(evidence.early),
    trend,
    evidence,
    modelVersion: ODDS_MODEL_VERSION,
  };
}

/** "HIT 63% · MISS 37%" — the only form these numbers take on Train. */
export function oddsLine(odds: CallOdds): string {
  return `HIT ${Math.round(odds.hitProbability * 100)}% · MISS ${Math.round(odds.missProbability * 100)}%`;
}
