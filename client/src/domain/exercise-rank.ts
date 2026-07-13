/**
 * THE ADD-EXERCISE SEARCH + RANKING ENGINE (Tyson, 2026-07-14). Pure: no React,
 * no network, no component state — so the thing that decides what an athlete
 * sees mid-set is testable, and tested.
 *
 * THE RULE THE SPEC IS BUILT ON: searching "bench" during a chest workout must
 * put Barbell Bench Press first — NOT "Bench-Supported Dumbbell Row", which
 * merely contains the word. Substring matching alone cannot do that. So every
 * candidate is SCORED, and the score is dominated by what kind of match it is
 * (exact name > alias > abbreviation > prefix > word > substring), then nudged
 * by what we know about this athlete (in their program, in their history, a
 * favourite, trains what they are training today), then broken ties by
 * popularity and finally, deterministically, by name.
 */

import {
  ALIASES,
  normaliseTerm,
  tokenise,
  type Category,
  type Difficulty,
  type Equipment,
  type LibraryExercise,
} from './exercise-taxonomy';

export interface RankContext {
  /** Exercises in the day/plan the athlete is training. */
  inProgram?: ReadonlySet<string>;
  /** Every exercise they have ever logged (lowercased names). */
  performed?: ReadonlySet<string>;
  /** Starred. */
  favourites?: ReadonlySet<string>;
  /** The muscles today's workout is already hitting. */
  targetMuscles?: ReadonlySet<string>;
  /** Already added to this workout — still listed, but never ranked up. */
  alreadyAdded?: ReadonlySet<string>;
  /** Hidden by the athlete: excluded entirely unless searched for by name. */
  hidden?: ReadonlySet<string>;
}

export interface ExerciseFilters {
  /** The 17-tag values the muscle chip/subgroup selects. Empty = any. */
  muscles?: readonly string[];
  equipment?: readonly Equipment[];
  categories?: readonly Category[];
  difficulties?: readonly Difficulty[];
  favouritesOnly?: boolean;
  performedOnly?: boolean;
  inProgramOnly?: boolean;
  customOnly?: boolean;
}

export interface Scored {
  exercise: LibraryExercise;
  score: number;
  /**
   * The TEXT that matched, lowercased. The row locates it in the name it is
   * actually rendering — never an offset, which was measured against the
   * NORMALISED name and pointed at the wrong character in any name containing
   * punctuation ("(Rea" got highlighted in "Reverse Pec Deck (Rear Delt Fly)").
   * Empty when the match was not on the name (muscle, equipment, alias).
   */
  match: string;
}

/**
 * Match strength. The CLASS of match dominates: no amount of popularity or
 * history promotes a substring match over an exact one. Class gaps are >= 2000,
 * which is more than popularity (<= 1000) and every context boost combined can
 * bridge — so the ordering between classes is a guarantee, not a hope.
 */
const S_EXACT = 10_000;
const S_ALIAS = 8_000;
/** Name starts with the query, or a WORD of it does. Deliberately ONE class:
 *  "Bench Sprint" starting with the word does not make it more of a "bench"
 *  than "Barbell Bench Press" — that is what popularity is for, and ranking
 *  those apart by mere position is exactly the bug the spec calls out. */
const S_WORD = 5_000;
/** Tiny nudge for matching at the very start — a tiebreak, not a class. */
const S_LEADING = 50;
const S_ALL_TOKENS = 3_000;
const S_SUBSTRING = 2_000;
const S_MUSCLE = 900;
const S_EQUIPMENT = 700;
const S_FUZZY = 500;

/** Popularity (1-100) scaled so it orders WITHIN a class and never across one. */
const POP_WEIGHT = 10;

/** Athlete signal. Nudges, never overrides a stronger KIND of match. */
const B_IN_PROGRAM = 400;
const B_PERFORMED = 260;
const B_FAVOURITE = 320;
const B_TARGET_MUSCLE = 180;
const B_ALREADY_ADDED = -600;

/** Levenshtein, capped — we only care "is this within 1-2 typos". */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1; // whole row already too far
    prev = cur;
  }
  return prev[b.length];
}

/** Expand a query through the alias table: "db incline" → also "dumbbell incline". */
export function expandQuery(query: string): string[] {
  const tokens = tokenise(query);
  const out: string[] = [];
  for (const t of tokens) {
    const alias = ALIASES[t];
    if (alias) out.push(...alias.flatMap((a) => tokenise(a)));
    else out.push(t);
  }
  // A whole-phrase alias ("lat machine") beats token-by-token.
  const phrase = ALIASES[normaliseTerm(query).replace(/\s+/g, '')];
  if (phrase) out.push(...phrase.flatMap((a) => tokenise(a)));
  return [...new Set(out)];
}

const searchableText = (e: LibraryExercise): string =>
  normaliseTerm(`${e.name} ${e.muscle} ${e.equipment ?? ''} ${(e.secondary ?? []).join(' ')}`);

/** Does this exercise pass the hard filters? Filters EXCLUDE; ranking orders. */
export function passesFilters(
  e: LibraryExercise,
  f: ExerciseFilters,
  ctx: RankContext,
  isCustom: (name: string) => boolean
): boolean {
  const key = e.name.toLowerCase();
  if (f.muscles && f.muscles.length > 0 && !f.muscles.includes(e.muscle)) return false;
  if (f.equipment && f.equipment.length > 0 && !f.equipment.includes(e.equipment ?? 'Other')) return false;
  if (f.categories && f.categories.length > 0 && !f.categories.includes(e.category ?? 'Other')) return false;
  if (f.difficulties && f.difficulties.length > 0 && !f.difficulties.includes(e.difficulty ?? 'Intermediate')) {
    return false;
  }
  if (f.favouritesOnly && !ctx.favourites?.has(key)) return false;
  if (f.performedOnly && !ctx.performed?.has(key)) return false;
  if (f.inProgramOnly && !ctx.inProgram?.has(key)) return false;
  if (f.customOnly && !isCustom(e.name)) return false;
  return true;
}

/** The match part of the score, plus where in the name to highlight. */
function matchScore(e: LibraryExercise, rawQuery: string, expanded: string[]): Scored | null {
  const q = normaliseTerm(rawQuery);
  if (q === '') return { exercise: e, score: 0, match: '' };

  const name = normaliseTerm(e.name);
  const text = searchableText(e);
  const hay = name.split(' ');

  if (name === q) return { exercise: e, score: S_EXACT, match: q };
  if (name.startsWith(q)) return { exercise: e, score: S_WORD + S_LEADING, match: q };

  // A WORD of the name starts with the query: "bench" → "Barbell BENCH Press".
  if (hay.some((w) => w.startsWith(q))) return { exercise: e, score: S_WORD, match: q };

  // Every expanded token present ("db incline" → dumbbell + incline).
  if (expanded.length > 0 && expanded.every((t) => text.includes(t))) {
    const first = expanded.find((t) => name.includes(t));
    const viaAlias = expanded.some((t) => !q.includes(t));
    return { exercise: e, score: viaAlias ? S_ALIAS : S_ALL_TOKENS, match: first ?? '' };
  }

  if (name.includes(q)) return { exercise: e, score: S_SUBSTRING, match: q };

  // Muscle / equipment text ("rear delt", "cable") — nothing in the NAME to
  // highlight, so the row highlights nothing rather than guessing.
  if (normaliseTerm(e.muscle).includes(q)) return { exercise: e, score: S_MUSCLE, match: '' };
  if (normaliseTerm(e.equipment ?? '').includes(q)) return { exercise: e, score: S_EQUIPMENT, match: '' };
  if (text.includes(q)) return { exercise: e, score: S_SUBSTRING - 500, match: '' };

  // Typos: only for words long enough that a typo is plausible, and only
  // against WORDS — fuzzy-matching whole names invites nonsense.
  if (q.length >= 4) {
    for (const w of hay) {
      if (Math.abs(w.length - q.length) <= 2 && editDistance(q, w) <= (q.length >= 7 ? 2 : 1)) {
        return { exercise: e, score: S_FUZZY, match: w };
      }
    }
  }
  return null;
}

/** The athlete-signal part of the score. */
function contextBoost(e: LibraryExercise, ctx: RankContext): number {
  const key = e.name.toLowerCase();
  let b = 0;
  if (ctx.inProgram?.has(key)) b += B_IN_PROGRAM;
  if (ctx.performed?.has(key)) b += B_PERFORMED;
  if (ctx.favourites?.has(key)) b += B_FAVOURITE;
  if (ctx.targetMuscles && ctx.targetMuscles.size > 0) {
    if (ctx.targetMuscles.has(e.muscle)) b += B_TARGET_MUSCLE;
    else if ((e.secondary ?? []).some((m) => ctx.targetMuscles!.has(m))) b += B_TARGET_MUSCLE / 3;
  }
  if (ctx.alreadyAdded?.has(key)) b += B_ALREADY_ADDED;
  return b;
}

export interface RankOptions {
  query: string;
  filters?: ExerciseFilters;
  context?: RankContext;
  limit?: number;
  isCustom?: (name: string) => boolean;
}

/**
 * The ranked result list. Ordering: score desc, then popularity desc, then name
 * — the last one is what makes the list DETERMINISTIC, which is what makes it
 * testable.
 */
export function rankExercises(
  library: readonly LibraryExercise[],
  opts: RankOptions
): Scored[] {
  const { query, filters = {}, context = {}, limit } = opts;
  const isCustom = opts.isCustom ?? (() => false);
  const expanded = expandQuery(query);
  const q = normaliseTerm(query);

  const out: Scored[] = [];
  for (const e of library) {
    const key = e.name.toLowerCase();
    // Hidden exercises stay hidden unless the athlete literally types the name.
    if (context.hidden?.has(key) && !(q !== '' && normaliseTerm(e.name).includes(q))) continue;
    if (!passesFilters(e, filters, context, isCustom)) continue;

    const m = matchScore(e, query, expanded);
    if (m === null) continue;

    // Popularity orders WITHIN the match class; the athlete's own signal nudges
    // on top. Neither can promote a weaker KIND of match over a stronger one.
    const pop = (e.popularity ?? 50) * POP_WEIGHT;
    out.push({ ...m, score: m.score + pop + contextBoost(e, context) });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = a.exercise.popularity ?? 50;
    const pb = b.exercise.popularity ?? 50;
    if (pb !== pa) return pb - pa;
    return a.exercise.name.localeCompare(b.exercise.name);
  });

  return limit ? out.slice(0, limit) : out;
}
