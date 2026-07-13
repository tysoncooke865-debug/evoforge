/**
 * THE DEFAULT VIEW of the Add Exercise menu — what an athlete sees BEFORE they
 * type anything.
 *
 * The core principle of the redesign: never open on a wall of 960 exercises.
 * With no query, the menu shows what is actually likely: what is already in
 * today's workout, what they did recently, what they starred, what suits what
 * they are training right now — and only then, the popular staples.
 *
 * Pure, and every section deduplicates against the ones above it: an exercise
 * shown under "In Your Program" must not appear again under "Recent". Seeing
 * the same row three times is how a list stops being scannable.
 */

import { rankExercises, type RankContext } from './exercise-rank';
import type { ExerciseHistory } from './exercise-history';
import type { LibraryExercise } from './exercise-taxonomy';
import { inferMuscleGroup } from './workouts';

export interface Section {
  key: string;
  title: string;
  exercises: LibraryExercise[];
}

export interface SectionInputs {
  library: readonly LibraryExercise[];
  /** Exercises in the day being trained (display names). */
  program: readonly string[];
  history: ExerciseHistory;
  favourites: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  /** The muscles today's workout already hits — drives "Suggested". */
  targetMuscles: ReadonlySet<string>;
  /** Already added this session; still shown, never suggested again. */
  alreadyAdded: ReadonlySet<string>;
  /** Hard filters, if the athlete has any set. */
  filterPass?: (e: LibraryExercise) => boolean;
}

const SUGGESTED = 8;
const POPULAR = 12;

/** Build the default sections, in the order the spec asks for. */
export function buildSections(input: SectionInputs): Section[] {
  const {
    library,
    program,
    history,
    favourites,
    hidden,
    targetMuscles,
    alreadyAdded,
    filterPass = () => true,
  } = input;

  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e]));
  const used = new Set<string>();
  const sections: Section[] = [];

  const take = (names: readonly string[], limit = Infinity): LibraryExercise[] => {
    const out: LibraryExercise[] = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (used.has(key) || hidden.has(key)) continue;
      // A name the library has never seen (a plan's "(Strength)" variants, an
      // athlete's own lift) still deserves a real muscle — "Other" in the
      // subtitle is the app admitting it did not try.
      const e = byName.get(key) ?? { name: n, muscle: inferMuscleGroup(n) };
      if (!filterPass(e)) continue;
      used.add(key);
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  };

  const inProgram = take(program);
  if (inProgram.length > 0) sections.push({ key: 'program', title: 'IN YOUR PROGRAM', exercises: inProgram });

  const recent = take(history.recent, 10);
  if (recent.length > 0) sections.push({ key: 'recent', title: 'RECENT', exercises: recent });

  // Favourites are display-cased from the library where possible.
  const favNames = [...favourites].map((k) => byName.get(k)?.name ?? k);
  const favs = take(favNames);
  if (favs.length > 0) sections.push({ key: 'favourites', title: 'FAVOURITES', exercises: favs });

  // SUGGESTED FOR TODAY: the ranking engine, with no query — which is exactly
  // "what fits this athlete, this workout, right now". Restricted to today's
  // muscles, because a leg suggestion during a chest session is noise.
  if (targetMuscles.size > 0) {
    const ctx: RankContext = {
      inProgram: new Set(program.map((p) => p.toLowerCase())),
      performed: history.performed,
      favourites,
      targetMuscles,
      alreadyAdded,
      hidden,
    };
    const ranked = rankExercises(library, {
      query: '',
      filters: { muscles: [...targetMuscles] },
      context: ctx,
    })
      .map((s) => s.exercise)
      .filter((e) => !used.has(e.name.toLowerCase()) && filterPass(e));
    const suggested = ranked.slice(0, SUGGESTED);
    suggested.forEach((e) => used.add(e.name.toLowerCase()));
    if (suggested.length > 0) {
      sections.push({ key: 'suggested', title: 'SUGGESTED FOR TODAY', exercises: suggested });
    }
  }

  // POPULAR: the fallback for a brand-new athlete with no history at all. It is
  // the staples, not obscure variations — that is what popularity encodes.
  const popular = library
    .filter((e) => !used.has(e.name.toLowerCase()) && !hidden.has(e.name.toLowerCase()) && filterPass(e))
    .slice()
    .sort((a, b) => (b.popularity ?? 50) - (a.popularity ?? 50) || a.name.localeCompare(b.name))
    .slice(0, POPULAR);
  if (popular.length > 0) sections.push({ key: 'popular', title: 'POPULAR', exercises: popular });

  return sections;
}
