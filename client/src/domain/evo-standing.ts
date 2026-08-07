/**
 * WHERE THE ATHLETE STANDS — the context that turns an Evo Rating from a
 * number into an identity.
 *
 * A rating alone answers "what am I?" and nothing else. These answer the three
 * questions that actually generate motivation: am I MOVING (this week's
 * change), where am I AGAINST OTHERS (position), and how far is the NEXT
 * THING (rank progress).
 *
 * EVERY VALUE HERE IS DERIVED FROM REAL ROWS OR RETURNS NULL. There is no
 * "top 1%" for an athlete nobody has ranked, and no "+2 this week" for someone
 * with one snapshot. A motivating number that is invented is worse than no
 * number, because the athlete eventually notices and stops believing the true
 * ones too.
 */

import { pyFloat } from './py';

export interface RatingSnapshot {
  displayed_rating?: unknown;
  calculated_at?: unknown;
}

/**
 * NOT `Number(v)`. `Number(null)` is 0 and `Number('')` is 0, so a rating the
 * server never computed would arrive here as a real score of zero — which
 * ranked never-rated athletes into the board and stole two places from
 * everyone below them. domain/py.ts exists for exactly this distinction
 * (raise-vs-default), and it is already the app's answer everywhere else.
 */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : pyFloat(v));

/**
 * How much the rating moved in the last `days`.
 *
 * Compares the newest snapshot against the newest one at least `days` old.
 * Null when there is no such earlier snapshot — a brand-new athlete has not
 * "gained 0 this week", they have no week yet, and those read very differently.
 */
export function ratingChange(
  snapshots: readonly RatingSnapshot[],
  nowMs: number,
  days = 7
): number | null {
  const rows = snapshots
    .map((s) => ({ rating: num(s.displayed_rating), at: Date.parse(String(s.calculated_at ?? '')) }))
    .filter((r): r is { rating: number; at: number } => r.rating !== null && Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at);
  if (rows.length < 2) return null;

  const latest = rows[0];
  const cutoff = nowMs - days * 86_400_000;
  // The newest snapshot that is OLD ENOUGH to be "a week ago". Falling back to
  // the oldest we have would silently compare against an arbitrary window.
  const earlier = rows.find((r) => r.at <= cutoff);
  if (!earlier) return null;
  return Math.round((latest.rating - earlier.rating) * 10) / 10;
}

export interface BoardEntry {
  display_name?: unknown;
  evo_rating?: unknown;
  rank_position?: unknown;
}

export interface Standing {
  /** 1-based position among RANKED athletes. */
  position: number;
  /** How many athletes carry a rating at all — the honest denominator. */
  total: number;
  /** 1..100, rounded up: position 1 of 50 is "top 2%". */
  topPercent: number;
  /** The rating of whoever is directly above, when there is someone. */
  chasingRating: number | null;
  chasingName: string | null;
}

/**
 * The athlete's place on the Evo board.
 *
 * Only counts entries that HAVE a rating: the board also carries athletes who
 * have never been rated, and ranking someone above them would be a comparison
 * against nothing. Null when the athlete is not on the board — private
 * profiles are not a failure state, they are a choice, and inventing a
 * position for them would be a lie about people they cannot see.
 */
export function standingOf(board: readonly BoardEntry[], myName: string | null): Standing | null {
  if (myName === null || myName.trim() === '') return null;
  const rated = board
    .map((b) => ({ name: String(b.display_name ?? ''), rating: num(b.evo_rating) }))
    .filter((b): b is { name: string; rating: number } => b.rating !== null)
    .sort((a, b) => b.rating - a.rating);
  if (rated.length === 0) return null;

  const idx = rated.findIndex((r) => r.name === myName);
  if (idx < 0) return null;

  const above = idx > 0 ? rated[idx - 1] : null;
  return {
    position: idx + 1,
    total: rated.length,
    topPercent: Math.max(1, Math.ceil(((idx + 1) / rated.length) * 100)),
    chasingRating: above?.rating ?? null,
    chasingName: above?.name ?? null,
  };
}

/**
 * ONE LINE OF CONTEXT, chosen by what is most motivating and true right now.
 *
 * Priority is deliberate: MOVEMENT beats position, because "you are climbing"
 * acts on behaviour and "you are 4th" does not. A standing with nobody above
 * is the summit and says so. Null when we know nothing worth saying — silence
 * is better than filler.
 */
export function standingLine(change: number | null, standing: Standing | null): string | null {
  if (change !== null && change > 0) {
    const pos = standing ? ` · #${standing.position}` : '';
    return `+${change} this week${pos}`;
  }
  if (standing === null) return change !== null && change < 0 ? `${change} this week` : null;
  if (standing.position === 1) return 'TOP OF THE BOARD';
  return `#${standing.position} · TOP ${standing.topPercent}%`;
}

/**
 * "3 workouts until your next form" — the requirement turned into an action.
 *
 * `perWorkout` is how much progress one session is worth; null when we cannot
 * estimate it, and then the caller says nothing rather than guessing a number
 * the athlete will hold us to.
 */
export function workoutsToEvolve(progressPct: number, perWorkout: number | null): number | null {
  if (perWorkout === null || perWorkout <= 0) return null;
  const remaining = 100 - progressPct;
  if (remaining <= 0) return 0;
  return Math.max(1, Math.ceil(remaining / perWorkout));
}
