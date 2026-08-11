import { exerciseIdFor } from './exercise-identity';
import type { WeightUnit } from './units';

/**
 * WHAT AN EXERCISE PREFERENCE MEANS — pure, so the rule can be tested without
 * react-query, AsyncStorage or a React tree (2026-08-11).
 *
 * The hooks that read and write the rows live in `data/exercise-prefs.ts`.
 * This file owns the part that can be wrong.
 *
 * ---- STORED BY NAME, READ BY IDENTITY ----
 *
 * `(user_id, exercise)` is the table's identity and the upsert's conflict
 * target (migration 019). That does not move: changing it would strand every
 * existing row behind a key nothing looks under.
 *
 * But a preference is a statement about the MOVEMENT, not about the wording
 * that happened to be on screen when it was made. Starring `Bench Press` and
 * then being handed `Bench Press (Strength Focused)` by an AI plan lost the
 * star, lost the hide, and — the one that actually hurts — reverted the KG⇄LB
 * lens to kilos, so an athlete who works in pounds got a card relabelled
 * under them and typed their next set into it.
 *
 * ---- WHY WRITES MUST CARRY SIBLINGS ----
 *
 * Reading canonically while writing by name alone would introduce a worse bug
 * than it fixes. Un-starring under a NEW spelling writes `is_favourite: false`
 * on a new row while the old row still says `true`; the canonical read finds
 * the old one; the star refuses to switch off. `siblingNames` is what the
 * mutations use to move every spelling of a lift together, so two rows can
 * never disagree about one exercise.
 */

export interface ExercisePref {
  exercise: string;
  is_favourite: boolean;
  is_hidden: boolean;
  /** KG ⇄ LB (migration 020). Display/input only — the database stays kg. */
  weight_unit?: WeightUnit;
}

export interface PrefSets {
  favourites: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  /** The same two, keyed by canonical exercise id. Kept SEPARATE rather than
   *  merged because the ranking engine's key space is lowercased NAMES
   *  (`e.name.toLowerCase()`), and mixing ids into it would silently stop
   *  every existing lookup from matching. */
  favouriteIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
}

/** Lowercased sets — the ranking engine's key format — plus their canonical
 *  twins, so a preference set under one spelling is honoured under another. */
export function prefSets(rows: ExercisePref[] | undefined): PrefSets {
  const favourites = new Set<string>();
  const hidden = new Set<string>();
  const favouriteIds = new Set<string>();
  const hiddenIds = new Set<string>();
  for (const r of rows ?? []) {
    const id = exerciseIdFor(r.exercise);
    if (r.is_favourite) {
      favourites.add(r.exercise.toLowerCase());
      favouriteIds.add(id);
    }
    if (r.is_hidden) {
      hidden.add(r.exercise.toLowerCase());
      hiddenIds.add(id);
    }
  }
  return { favourites, hidden, favouriteIds, hiddenIds };
}

/** Is this exercise favourited, under ANY spelling the athlete has used? */
export function isFavourite(
  prefs: Pick<PrefSets, 'favourites' | 'favouriteIds'>,
  exercise: string
): boolean {
  return prefs.favourites.has(exercise.toLowerCase()) || prefs.favouriteIds.has(exerciseIdFor(exercise));
}

/** Hidden, under any spelling. */
export function isHidden(prefs: Pick<PrefSets, 'hidden' | 'hiddenIds'>, exercise: string): boolean {
  return prefs.hidden.has(exercise.toLowerCase()) || prefs.hiddenIds.has(exerciseIdFor(exercise));
}

/**
 * The unit an athlete sees and types for one exercise. Absent row/column = kg.
 *
 * The EXACT name wins — if they set this spelling specifically, that is what
 * they meant. Failing that, any spelling of the same exercise that carries an
 * explicit unit.
 */
export function unitFor(rows: ExercisePref[] | undefined, exercise: string): WeightUnit {
  const exact = (rows ?? []).find((r) => r.exercise === exercise);
  if (exact?.weight_unit) return exact.weight_unit === 'lb' ? 'lb' : 'kg';
  const wanted = exerciseIdFor(exercise);
  const sibling = (rows ?? []).find((r) => r.weight_unit && exerciseIdFor(r.exercise) === wanted);
  return sibling?.weight_unit === 'lb' ? 'lb' : 'kg';
}

/** Every cached row denoting the SAME exercise as `exercise`, including it —
 *  the rows a write must carry along so two spellings cannot disagree. */
export function siblingNames(rows: ExercisePref[] | undefined, exercise: string): string[] {
  const wanted = exerciseIdFor(exercise);
  const out = new Set<string>([exercise]);
  for (const r of rows ?? []) {
    if (r.exercise !== exercise && exerciseIdFor(r.exercise) === wanted) out.add(r.exercise);
  }
  return [...out];
}
