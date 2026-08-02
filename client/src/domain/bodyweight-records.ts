/**
 * PERSONAL RECORDS FOR BODYWEIGHT MOVEMENTS (133).
 *
 * THE BUG. One numeric `weight` column meant one record type, and it was the
 * wrong one for every bodyweight movement:
 *
 *   * a plain bodyweight set has e1RM 0, so twelve strict pull-ups could
 *     NEVER register a record;
 *   * an assisted set stored assistance as weight lifted, so an athlete
 *     dropping from 30 kg of help to 20 kg — real, visible progress — read
 *     as a REGRESSION;
 *   * a weighted set and an assisted set were ranked against each other on
 *     the same number, which is meaningless.
 *
 * So records are SEPARATED BY MODE and each has its own direction. Nothing
 * here compares across modes, and nothing here is decided by a model: every
 * record is a deterministic max or min over stored rows.
 */

import { calculateEffectiveResistanceKg, canonicalFromRow, type CanonicalSet } from './exercise-load';
import { estimated1rm } from './workouts';

export type BodyweightRecordKind =
  | 'most_unweighted_reps'
  | 'highest_added_weight'
  | 'best_weighted_e1rm'
  | 'lowest_assistance'
  | 'first_unassisted'
  | 'longest_duration';

export interface BodyweightRecord {
  kind: BodyweightRecordKind;
  exercise: string;
  /** The record's headline number, in the unit its kind implies. */
  value: number;
  reps: number | null;
  date: string;
  label: string;
}

interface Row {
  exercise?: unknown;
  date?: unknown;
  reps?: unknown;
  [k: string]: unknown;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every bodyweight record for one exercise.
 *
 * Deliberately returns a LIST rather than "the PR": these are different
 * achievements, not competing candidates for one slot, and collapsing them
 * is what produced the original bug.
 */
export function bodyweightRecords(rows: Row[], exercise: string): BodyweightRecord[] {
  const mine = rows.filter((r) => String(r.exercise) === exercise);
  if (mine.length === 0) return [];

  const out: BodyweightRecord[] = [];
  const push = (
    kind: BodyweightRecordKind,
    value: number,
    reps: number | null,
    date: string,
    label: string
  ) => out.push({ kind, exercise, value, reps, date, label });

  let bestReps: { v: number; reps: number; date: string } | null = null;
  let bestAdded: { v: number; reps: number; date: string } | null = null;
  let bestWeighted: { v: number; reps: number; date: string } | null = null;
  let lowestAssist: { v: number; reps: number; date: string } | null = null;
  let firstUnassisted: string | null = null;
  let longest: { v: number; date: string } | null = null;

  for (const r of mine) {
    const set: CanonicalSet = canonicalFromRow(r as Record<string, unknown>);
    const date = String(r.date ?? '');
    const reps = num(set.reps) ?? 0;

    switch (set.loadMode) {
      case 'bodyweight':
      case 'repetition_only': {
        if (reps > 0 && (!bestReps || reps > bestReps.v)) bestReps = { v: reps, reps, date };
        // "First unassisted rep" is a milestone, not a maximum: the EARLIEST
        // date on which the athlete did the movement without help.
        if (reps > 0 && (firstUnassisted === null || date < firstUnassisted)) firstUnassisted = date;
        break;
      }
      case 'weighted_bodyweight': {
        const added = set.externalLoadKg ?? 0;
        if (added > 0 && (!bestAdded || added > bestAdded.v)) bestAdded = { v: added, reps, date };
        const eff = calculateEffectiveResistanceKg(set);
        // Needs a bodyweight snapshot. Without one there is no honest
        // effective load, so the set is EXCLUDED rather than guessed at.
        if (eff != null && reps > 0) {
          const e1rm = estimated1rm(eff, reps);
          if (!bestWeighted || e1rm > bestWeighted.v) bestWeighted = { v: e1rm, reps, date };
        }
        break;
      }
      case 'assisted_bodyweight': {
        const assist = set.assistanceKg;
        // LOWER IS BETTER — the direction that was inverted before.
        // Compared only at a like-for-like rep count or better, so "5 reps
        // with 20 kg" cannot be beaten by "1 rep with 19 kg".
        if (assist != null && reps > 0) {
          if (!lowestAssist || assist < lowestAssist.v || (assist === lowestAssist.v && reps > lowestAssist.reps)) {
            lowestAssist = { v: assist, reps, date };
          }
        }
        break;
      }
      case 'duration': {
        const secs = set.durationSeconds ?? 0;
        if (secs > 0 && (!longest || secs > longest.v)) longest = { v: secs, date };
        break;
      }
      default:
        break;
    }
  }

  if (bestReps) push('most_unweighted_reps', bestReps.v, bestReps.reps, bestReps.date, `${bestReps.v} unweighted reps`);
  if (bestAdded) push('highest_added_weight', bestAdded.v, bestAdded.reps, bestAdded.date, `BW + ${bestAdded.v} kg × ${bestAdded.reps}`);
  if (bestWeighted) push('best_weighted_e1rm', Math.round(bestWeighted.v * 10) / 10, bestWeighted.reps, bestWeighted.date, 'best weighted effort');
  if (lowestAssist) push('lowest_assistance', lowestAssist.v, lowestAssist.reps, lowestAssist.date, `BW − ${lowestAssist.v} kg × ${lowestAssist.reps}`);
  if (firstUnassisted) push('first_unassisted', 1, null, firstUnassisted, 'first unassisted rep');
  if (longest) push('longest_duration', longest.v, null, longest.date, `${longest.v} sec`);

  return out;
}

/**
 * Is this set a personal record WITHIN ITS OWN MODE?
 *
 * Deterministic, and never cross-mode: an assisted set is compared only with
 * previous assisted sets, a weighted set only with weighted ones.
 */
export function isModeRecord(rows: Row[], exercise: string, candidate: CanonicalSet): boolean {
  const prior = bodyweightRecords(rows, exercise);
  const reps = candidate.reps ?? 0;
  switch (candidate.loadMode) {
    case 'bodyweight':
    case 'repetition_only': {
      const best = prior.find((p) => p.kind === 'most_unweighted_reps');
      return reps > 0 && (!best || reps > best.value);
    }
    case 'weighted_bodyweight': {
      const best = prior.find((p) => p.kind === 'highest_added_weight');
      const added = candidate.externalLoadKg ?? 0;
      return added > 0 && (!best || added > best.value);
    }
    case 'assisted_bodyweight': {
      const best = prior.find((p) => p.kind === 'lowest_assistance');
      const assist = candidate.assistanceKg;
      return assist != null && reps > 0 && (!best || assist < best.value);
    }
    case 'duration': {
      const best = prior.find((p) => p.kind === 'longest_duration');
      const secs = candidate.durationSeconds ?? 0;
      return secs > 0 && (!best || secs > best.value);
    }
    default:
      return false;
  }
}
