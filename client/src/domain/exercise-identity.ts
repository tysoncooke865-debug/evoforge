/**
 * CANONICAL EXERCISE IDENTITY — the one place EvoForge decides what an
 * exercise IS (2026-08-10).
 *
 * ---- THE BUG THIS EXISTS TO END ----
 *
 * `workout_log.exercise` is a text column, and every history lookup used to
 * compare it with `===`. So the moment an AI plan wrote
 *
 *     Bench Press (Strength Focused)
 *
 * the athlete's four years of `Bench Press` became invisible: no "last time",
 * no prefill, no PR baseline, and a fresh set of numbers to type from memory.
 * The app depended on a language model spelling a free-form string the same
 * way twice, which is not a thing a language model does.
 *
 * THE RULE, and it is the whole design:
 *
 *     AI GENERATES PROGRAMMING. EVOFORGE OWNS EXERCISE IDENTITY.
 *
 * A model may change wording, focus, rep targets, RIR, tempo, cues and notes
 * as much as it likes. None of that may mint a new exercise.
 *
 * ---- WHY THE ID IS DERIVED, NOT ISSUED ----
 *
 * `exercise_id` is a pure function of the name: normalise, then fold spaces to
 * underscores. That buys three things a random key could not:
 *
 *   1. EVERY EXISTING ROW ALREADY HAS ONE. Four years of history resolve on
 *      read, with no migration, no backfill and no window where the app is
 *      half-migrated. Migration 192 stores the id going forward because
 *      future server-side features (strength graphs, plateau detection) will
 *      want to GROUP BY it — but the stored column is an optimisation. The
 *      mechanism is this function, and it cannot fail to run.
 *   2. It is reproducible in SQL and in an edge function without shipping a
 *      lookup table to either.
 *   3. It is stable. Regenerating the catalogue never renumbers anything.
 *
 * ---- THE SAFETY PROPERTY ----
 *
 * Resolution only ever MERGES on high confidence, and its fallback is
 * name-identity — precisely the behaviour the app has today. It can make
 * history more connected than it currently is; it cannot invent a connection
 * between two different lifts. That asymmetry is why this can ship against
 * live tester data: the worst case of a missing alias is the status quo,
 * while the worst case of a wrong one is two athletes' bench and incline
 * numbers in one graph. So when in doubt, this file does nothing.
 *
 * Deliberately imports only the GENERATED projection, never EXERCISE_LIBRARY:
 * this runs on set save, on the previous-set prefill and in the set queue, and
 * pulling the ~210KB library into the shared boot chunk is the exact mistake
 * muscle-lookup.ts was carved out to undo.
 */

import { EXERCISE_ALIASES } from './exercise-aliases';
import { CANONICAL_NAME_BY_ID, EXERCISE_ID_BY_NAME } from './exercise-ids.generated';

export interface UserExerciseRef {
  id?: string;
  name: string;
}

export type IdentitySource = 'id' | 'alias' | 'catalogue' | 'descriptor' | 'custom' | 'unknown';

export interface ResolvedExercise {
  /** Permanent. 'barbell_bench_press' | 'custom_<uuid>' | 'name_<slug>'. */
  exerciseId: string;
  /** What to show when nothing better is on hand. Never an identity. */
  canonicalName: string;
  /** Which rung of the ladder answered — for tests and diagnostics. */
  source: IdentitySource;
}

/**
 * THE normalisation. Byte-identical to `normalise` in
 * scripts/gen-exercise-ids.mjs (the test pins them against each other,
 * because a generator that normalises differently emits a map this can never
 * hit). Apostrophes vanish; every other non-alphanumeric run folds to one
 * space; digits survive, because "45 degree" and "t bar" mean something.
 */
export function normaliseExerciseName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A normalised name -> its id. The id IS the name with spaces folded. */
const idFromNormalised = (normalised: string): string => normalised.replace(/ /g, '_');

/**
 * PRESCRIPTION WORDS — the ONLY tokens a trailing descriptor may be made of.
 *
 * This list is the safety valve on descriptor stripping. `Bench Press
 * (Strength Focused)` strips because every token inside the brackets is here;
 * `Cable Lat Pullover (Straight-Arm Pulldown)` does not, because "pulldown"
 * is not — and that name is a real exercise whose own brackets are part of it.
 *
 * NOTHING MECHANICAL MAY EVER JOIN THIS LIST. incline, decline, dumbbell,
 * barbell, smith, machine, cable, close/wide/neutral, grip, seated, standing,
 * unilateral, single, arm, leg, assisted, weighted, paused, front, sumo,
 * reverse, deficit, deep, high, low — every one of those changes which
 * exercise is being done, and stripping any of them would merge two lifts.
 */
const PRESCRIPTION_WORDS: ReadonlySet<string> = new Set([
  // training intent
  'strength', 'hypertrophy', 'power', 'endurance', 'conditioning', 'stability',
  'focus', 'focused', 'emphasis', 'emphasised', 'emphasized', 'biased', 'bias',
  'intensity', 'intensification', 'volume', 'deload', 'peak', 'peaking', 'base',
  'technique', 'skill', 'practice', 'primer', 'activation',
  // set/rep vocabulary
  'set', 'sets', 'rep', 'reps', 'repetition', 'repetitions', 'rir', 'rpe',
  // NOT 'pause' and NOT 'rest': "rest-pause" is a real prescription, but
  // `Paused Barbell Bench Press` is a real and DIFFERENT exercise, and
  // stripping "(Pause)" would fold a paused bench into an ordinary one.
  // Losing the rest-pause case is the cheap side of that trade.
  'amrap', 'emom', 'tempo', 'cluster', 'myo', 'superset',
  'dropset', 'drop', 'backoff', 'back', 'off', 'top', 'straight', 'working',
  'work', 'warmup', 'warm', 'up', 'finisher', 'burnout', 'pump', 'burn',
  // programme vocabulary
  'week', 'day', 'phase', 'block', 'wave', 'main', 'primary', 'secondary',
  'accessory', 'optional', 'compound', 'isolation', 'lift', 'movement',
  // intensity adjectives
  'heavy', 'light', 'lighter', 'heavier', 'moderate', 'hard', 'easy', 'max',
  'maximal', 'submaximal', 'effort', 'controlled', 'explosive', 'speed', 'slow',
  // units and connectives that ride along
  'x', 'to', 'and', 'or', 'at', 'of', 'per', 'kg', 'lb', 'lbs', 'percent',
  'pct', 'sec', 'secs', 'second', 'seconds', 'min', 'mins', 'minute', 'minutes',
]);

/** Numbers and rep schemes ("5x5" survives normalisation intact). */
const isNumericToken = (t: string): boolean => /^[0-9]+$/.test(t) || /^[0-9]+x[0-9]+$/.test(t);

const isPrescriptionSegment = (segment: string): boolean => {
  const tokens = normaliseExerciseName(segment).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => PRESCRIPTION_WORDS.has(t) || isNumericToken(t));
};

/**
 * Peel ONE trailing descriptor off a name, or return null when there is
 * nothing safe to peel. Handles the four shapes a coach or a model writes:
 *
 *     Bench Press (Strength Focused)      bracketed
 *     Bench Press [Heavy]                 bracketed
 *     Bench Press - Heavy                 dash, en dash, em dash
 *     Bench Press: 5x5                    colon
 *
 * A DASH must have whitespace before it, or a hyphenated NAME would be peeled
 * apart: "Close-Grip Bench Press" and "Low-to-High Incline Cable Fly" are one
 * name each. A colon or comma needs no such protection — no exercise in the
 * catalogue contains either — so "Bench Press: 3 x 10" is caught too.
 */
function stripOneDescriptor(name: string): string | null {
  const trimmed = name.trim();

  const bracket = /^(.*\S)\s*[([{]([^)\]}]*)[)\]}]\s*$/.exec(trimmed);
  if (bracket && isPrescriptionSegment(bracket[2])) return bracket[1].trim();

  const dashed = /^(.*\S)\s+[-–—|]\s*(.+)$/.exec(trimmed);
  if (dashed && isPrescriptionSegment(dashed[2])) return dashed[1].trim();

  const punctuated = /^(.*\S)\s*[:,]\s*(.+)$/.exec(trimmed);
  if (punctuated && isPrescriptionSegment(punctuated[2])) return punctuated[1].trim();

  return null;
}

/** normalised alias -> canonical id, flattened once at module load. */
const ALIAS_TO_ID: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [id, aliases] of Object.entries(EXERCISE_ALIASES)) {
    for (const a of aliases) {
      const key = normaliseExerciseName(a);
      if (key !== '') m.set(key, id);
    }
  }
  return m;
})();

/**
 * PLURALS, folded generically rather than listed one by one.
 *
 * Production has `Face Pull` beside `Face Pulls`, `Hammer Curl` beside
 * `Hammer Curls`, `Leg Extension` beside `Leg Extensions` and `Seated Cable
 * Row` beside `Seated Cable Rows` — four fragmentations from one habit. The
 * same fold `tokenise()` already uses for search: drop a trailing 's' from
 * words long enough for it to be a plural, never from a double-s ("Press",
 * "Cross" survive; "Triceps" folds to "tricep", which is harmless because
 * BOTH sides of the comparison are folded).
 */
const depluralise = (normalised: string): string =>
  normalised
    .split(' ')
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
    .join(' ');

/**
 * depluralised name -> id, for every catalogue name and alias.
 *
 * AMBIGUITY IS DELETED, NOT GUESSED: if two names with different ids fold to
 * the same key, neither is reachable this way. The exact lookups above still
 * answer for both, so the cost is a plural that stays fragmented — which is
 * the status quo — and never a wrong merge.
 */
const DEPLURAL_TO_ID: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (name: string, id: string) => {
    const key = depluralise(name);
    if (key === name && m.get(key) === id) return;
    const seen = m.get(key);
    if (seen !== undefined && seen !== id) {
      ambiguous.add(key);
      return;
    }
    m.set(key, id);
  };
  for (const [name, id] of Object.entries(EXERCISE_ID_BY_NAME)) add(name, id);
  for (const [id, aliases] of Object.entries(EXERCISE_ALIASES)) {
    for (const a of aliases) add(normaliseExerciseName(a), id);
  }
  for (const k of ambiguous) m.delete(k);
  return m;
})();

/** The catalogue/alias lookup for an already-normalised name. The alias table
 *  is asked FIRST so a curated merge outranks a duplicate catalogue row. */
function lookupNormalised(normalised: string): { id: string; source: IdentitySource } | null {
  if (normalised === '') return null;
  const alias = ALIAS_TO_ID.get(normalised);
  if (alias) return { id: alias, source: 'alias' };
  const catalogue = EXERCISE_ID_BY_NAME[normalised];
  if (catalogue) return { id: catalogue, source: 'catalogue' };
  const plural = DEPLURAL_TO_ID.get(depluralise(normalised));
  if (plural) return { id: plural, source: 'catalogue' };
  return null;
}

/** Every alias target, for the guard test. */
export const ALIAS_TARGET_IDS: readonly string[] = Object.keys(EXERCISE_ALIASES);

/** The library's own display name for an id, when it has one. */
export function canonicalNameForId(exerciseId: string): string | null {
  return CANONICAL_NAME_BY_ID[exerciseId] ?? null;
}

/** Prefix for an athlete's own exercise (its `user_exercises.id` uuid is
 *  already permanent — §12 wants a stable id, not a second table). */
const CUSTOM_PREFIX = 'custom_';
/** Prefix for a name nothing recognises. Deterministic, so the same free
 *  text always groups with itself, and NOTHING ELSE. */
const NAME_PREFIX = 'name_';

export function isCustomExerciseId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

/**
 * THE RESOLVER (§6). Every flow that receives an exercise goes through here:
 * AI workouts, quick workouts, manual creation, saved routines, templates,
 * imports, challenges, historical rows and the picker.
 *
 * Order, each rung strictly more permissive than the one above:
 *
 *   1. an id we already issued            (id)
 *   2. a curated alias                    (alias)
 *   3. an exact normalised catalogue name (catalogue)
 *   4. the athlete's own exercise         (custom)
 *   5. peel a prescription descriptor, retry 2-4   (descriptor)
 *   6. a stable id derived from the name  (unknown)
 *
 * Note the ORDER of 3 and 5: the full string is matched against the catalogue
 * BEFORE anything is stripped, which is what keeps real names whose brackets
 * are part of them — `Skull Crusher (Lying Triceps Extension)`, `Reverse Pec
 * Deck (Rear Delt Fly)` — intact.
 */
export function resolveExercise(
  input: string | { exerciseId?: string | null; name?: string | null },
  userExercises: readonly UserExerciseRef[] = []
): ResolvedExercise {
  const explicitId = typeof input === 'string' ? null : (input.exerciseId ?? null);
  const rawName = typeof input === 'string' ? input : (input.name ?? '');

  // 1 — an id we already issued. A custom id is authoritative on sight; a
  // catalogue id must actually exist, or a typo would become an identity.
  if (explicitId) {
    const id = explicitId.trim();
    if (isCustomExerciseId(id)) {
      const owned = userExercises.find((u) => u.id && `${CUSTOM_PREFIX}${u.id}` === id);
      return { exerciseId: id, canonicalName: owned?.name ?? (rawName.trim() || id), source: 'id' };
    }
    if (CANONICAL_NAME_BY_ID[id]) {
      return { exerciseId: id, canonicalName: CANONICAL_NAME_BY_ID[id], source: 'id' };
    }
    // Unknown id: fall through and resolve the NAME. A model that invents
    // `bench_press_strength` must not thereby invent an exercise.
  }

  const name = rawName.trim();
  if (name === '') return { exerciseId: '', canonicalName: '', source: 'unknown' };

  // 2-5, walking one descriptor peel at a time.
  let candidate = name;
  let peeled = false;
  for (let guard = 0; guard < 4; guard++) {
    const normalised = normaliseExerciseName(candidate);

    const hit = lookupNormalised(normalised);
    if (hit) {
      return {
        exerciseId: hit.id,
        canonicalName: CANONICAL_NAME_BY_ID[hit.id] ?? candidate,
        source: peeled ? 'descriptor' : hit.source,
      };
    }

    // 4 — the athlete's own. Checked after the catalogue so creating "Bench
    // Press" by hand does not detach that athlete from the library's history,
    // and before the peel so a custom name containing a prescription-looking
    // word is not quietly rewritten.
    const own = userExercises.find((u) => normaliseExerciseName(u.name) === normalised);
    if (own?.id) {
      return {
        exerciseId: `${CUSTOM_PREFIX}${own.id}`,
        canonicalName: own.name,
        source: peeled ? 'descriptor' : 'custom',
      };
    }

    const stripped = stripOneDescriptor(candidate);
    if (stripped === null || stripped === candidate) break;
    candidate = stripped;
    peeled = true;
  }

  // 6 — unknown. A stable id from the ORIGINAL name, never the peeled one:
  // if nothing recognised it, we have no grounds to claim the descriptor was
  // decoration rather than the point.
  const normalised = normaliseExerciseName(name);
  return {
    exerciseId: `${NAME_PREFIX}${idFromNormalised(normalised)}`,
    canonicalName: name,
    source: 'unknown',
  };
}

/**
 * The hot-path shorthand: just the id. Memoised, because the previous-set
 * lookup calls it once per row over a log capped at 2,500 rows, on every
 * render of the logger.
 */
const idCache = new Map<string, string>();
const ID_CACHE_LIMIT = 4000;

export function exerciseIdFor(name: string, userExercises: readonly UserExerciseRef[] = []): string {
  // Only the no-custom-exercises case is cacheable: the answer otherwise
  // depends on a list this signature does not key on.
  if (userExercises.length > 0) return resolveExercise(name, userExercises).exerciseId;
  const hit = idCache.get(name);
  if (hit !== undefined) return hit;
  const id = resolveExercise(name).exerciseId;
  if (idCache.size >= ID_CACHE_LIMIT) idCache.clear();
  idCache.set(name, id);
  return id;
}

/**
 * Do two names denote the same exercise? The question every history lookup
 * is really asking. `rowExerciseId` lets a caller pass a row's STORED
 * exercise_id (migration 192) so a backfilled row skips resolution entirely.
 */
export function sameExercise(
  a: string,
  b: string,
  userExercises: readonly UserExerciseRef[] = []
): boolean {
  return a === b || exerciseIdFor(a, userExercises) === exerciseIdFor(b, userExercises);
}
