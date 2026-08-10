/**
 * EXERCISE ALIASES — the hand-curated half of canonical identity.
 *
 * The generated catalogue (exercise-ids.generated.ts) knows every name the
 * library ships. This file knows the names PEOPLE and MODELS actually write:
 * "Bench Press" for a barbell bench press, "RDL" for a Romanian deadlift,
 * "Lat Pull Down" for a lat pulldown.
 *
 * ---- THE RULE THIS TABLE OBEYS ----
 *
 * An alias may only be added when the two names denote THE SAME MOVEMENT. It
 * may never collapse a mechanical difference. The resolver's fallback is
 * name-identity — i.e. today's behaviour — so a MISSING alias costs a little
 * history and an incorrect one silently merges two different lifts' numbers.
 * Those are not symmetric mistakes. When unsure, leave it out.
 *
 * Specifically NOT aliased, and deliberately so:
 *   - `pull up` -> anything. The library has `weighted_pull_up`,
 *     `assisted_pull_up` and `archer_pull_up`, and a plain pull-up is none of
 *     them. It resolves to its own stable `name_pull_up`.
 *   - `wide grip lat pulldown` <-> `close_grip_lat_pulldown`. Both are real
 *     catalogue entries and the catalogue does not call them one exercise.
 *   - `dumbbell shoulder press` -> `seated_dumbbell_shoulder_press`. Seated
 *     and standing are a mechanical difference; the same reason "seated" is on
 *     the never-strip list in exercise-identity.ts.
 *
 * ---- THE SECOND JOB: REPAIRING THE LIBRARY'S OWN DUPLICATES ----
 *
 * EXERCISE_LIBRARY is the hand-curated core PLUS an 848-entry public-domain
 * import, and the two overlap: `Barbell Back Squat` and `Barbell Squat` are
 * both in there, as are `Cable Triceps Pushdown` and `Triceps Pushdown`. An
 * athlete who logged one and was later handed the other has their history
 * split across two rows of the same table. Entries marked DUPLICATE below
 * fold one catalogue name into another on purpose — they are the fragmentation
 * this change exists to repair, not an alias in the loose sense.
 *
 * Keys are canonical exercise ids; values are alias strings, matched after
 * normaliseExerciseName(). Pinned by __tests__/exercise-identity.test.ts,
 * which asserts every key is a real catalogue id (an alias pointing at
 * nothing would resolve to nothing).
 */

export const EXERCISE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // ---------------------------------------------------------------- press
  barbell_bench_press: [
    'bench press',
    'flat bench press',
    'flat barbell bench press',
    'barbell flat bench press',
    'bb bench press',
    'flat barbell press',
    'barbell bench',
    'bench press barbell',
  ],
  incline_barbell_bench_press: [
    'incline bench press',
    'incline barbell press',
    'incline bb bench press',
    'incline barbell bench',
  ],
  incline_dumbbell_bench_press: [
    'incline dumbbell press', // DUPLICATE catalogue entry
    'incline db bench press',
    'incline db press',
    'incline dumbbell bench',
  ],
  dumbbell_flat_bench_press: [
    'dumbbell bench press', // DUPLICATE catalogue entry
    'db bench press',
    'flat dumbbell bench press',
    'flat db bench press',
    'dumbbell bench',
    'db bench',
  ],
  smith_machine_bench_press: ['smith bench press', 'smith machine bench'],
  close_grip_bench_press: ['close grip bench', 'cgbp'],
  overhead_barbell_press: [
    'overhead press',
    'ohp',
    'military press',
    'barbell overhead press',
    'barbell shoulder press',
    'standing barbell overhead press',
    // Both of these are live in production, 12 rows each, same lift.
    'standing overhead press',
    'standing overhead barbell press',
  ],

  // ----------------------------------------------------------------- back
  lat_pulldown: ['lat pull down', 'lat pulldowns', 'pulldown', 'pull down'],
  barbell_bent_over_row: [
    'bent over row',
    'barbell row',
    'bent over barbell row',
    'bor',
    'barbell bent over rows',
  ],
  seated_cable_row: ['cable row', 'seated row', 'seated cable rows'],

  // ----------------------------------------------------------------- legs
  barbell_back_squat: [
    'barbell squat', // DUPLICATE catalogue entry
    'back squat',
    'squat',
    'bb back squat',
    'barbell back squats',
  ],
  barbell_deadlift: ['deadlift', 'conventional deadlift', 'bb deadlift'],
  romanian_deadlift: ['rdl', 'romanian dead lift', 'barbell romanian deadlift'],
  barbell_hip_thrust: ['hip thrust', 'hip thrusts', 'barbell hip thrusts'],

  // ----------------------------------------------------------------- arms
  ez_bar_curl: ['ez curl', 'ez bar curls', 'ez bar biceps curl'],
  barbell_curl: ['bb curl', 'standing barbell curl', 'barbell curls'],
  dumbbell_biceps_curl: ['dumbbell curl', 'db curl', 'dumbbell bicep curl', 'db biceps curl'],
  cable_triceps_pushdown: [
    'triceps pushdown', // DUPLICATE catalogue entry
    'tricep pushdown',
    'cable tricep pushdown',
    'pushdown',
    'triceps push down',
  ],

  // ------------------------------------------------------------------ abs
  // Word order, not a different movement — both live in production.
  machine_ab_crunch: ['ab crunch machine'],

  // ---------------------------------------------- DUPLICATE catalogue rows
  //
  // The curated core and the imported set each shipped their own spelling of
  // the same fourteen movements — singular beside plural, "bicep" beside
  // "biceps". The resolver's generic plural fold REFUSES these on purpose:
  // both spellings are real catalogue entries with different ids, and it
  // will not pick a winner on its own. So they are picked here, by hand, one
  // line each, and the curated form wins. (`seated cable rows` and
  // `dumbbell bicep curl` are already folded above.)
  bench_dip: ['bench dips'],
  cable_shrug: ['cable shrugs'],
  donkey_calf_raise: ['donkey calf raises'],
  hammer_curl: ['hammer curls'],
  leg_extension: ['leg extensions'],
  lying_leg_curl: ['lying leg curls'],
  machine_biceps_curl: ['machine bicep curl'],
  machine_preacher_curl: ['machine preacher curls'],
  rack_pull: ['rack pulls'],
  squat_with_bands: ['squats with bands'],
  standing_calf_raise: ['standing calf raises'],
  zercher_squat: ['zercher squats'],

  // ------------------------------------------------------------- shoulders
  dumbbell_lateral_raise: [
    'lateral raise',
    'lat raise',
    'side raise',
    'db lateral raise',
    'dumbbell side raise',
    'dumbbell lateral raises',
  ],
};
