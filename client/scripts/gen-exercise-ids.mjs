// gen-exercise-ids.mjs — regenerate src/domain/exercise-ids.generated.ts
//
// WHY THIS EXISTS (2026-08-10, the training-system upgrade): an exercise's
// IDENTITY must stop being the string somebody happened to type. Every logged
// set, every plan row and every AI response now resolves through a permanent
// canonical id (domain/exercise-identity.ts), and that resolver runs on the
// hot paths — set save, the previous-set prefill, the set queue. Importing
// EXERCISE_LIBRARY there would drag the whole ~210KB library into the shared
// boot chunk, which is exactly the mistake gen-muscle-by-name.mjs was written
// to undo. So this emits the compact projection those paths need:
//
//     normalised name -> exercise id          (the lookup)
//     exercise id     -> canonical name       (the display name)
//
// THE ID IS A PURE FUNCTION OF THE NORMALISED NAME (spaces -> underscores),
// so it is stable across regenerations, reproducible in SQL, and reproducible
// in the edge functions. It is NOT a random key: a random key would have to be
// stored somewhere to survive, and there is no table that owns the library.
//
// COLLISIONS ARE A HARD FAILURE. Two DIFFERENT normalised names that slug to
// the same id would silently merge two different lifts' histories — the exact
// class of bug this whole change exists to remove. Normalisation folds
// punctuation to spaces before slugging, so distinct keys cannot collide; if
// that ever stops being true this script refuses to emit rather than shipping
// a merge nobody chose.
//
// Source of truth is UNCHANGED: CORE_EXERCISES + IMPORTED_EXERCISES. The
// projection is pinned by src/domain/__tests__/exercise-identity.test.ts,
// which fails on ANY drift — editing the library without rerunning this script
// is a red test, not a silent lie.
//
// Run: node scripts/gen-exercise-ids.mjs   (from client/)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same order and same parse as gen-muscle-by-name.mjs: CORE first, then the
// imported set, last duplicate wins.
const SOURCES = ['src/domain/exercise-library.ts', 'src/domain/exercise-library-imported.ts'];

const STR = `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
const ENTRY = new RegExp(`\\{\\s*name:\\s*${STR}\\s*,\\s*muscle:\\s*${STR}`, 'g');
const unquote = (s) => s.slice(1, -1).replace(/\\(['"\\])/g, '$1');

/**
 * THE normalisation. Kept byte-identical to `normaliseExerciseName` in
 * src/domain/exercise-identity.ts — the test pins them against each other,
 * because a generator that normalises differently from the runtime resolver
 * produces a map the resolver can never hit.
 *
 * Apostrophes are DELETED ("farmer's" -> "farmers"); every other non
 * alphanumeric run folds to a single space. Digits survive: "45 degree" and
 * "t bar" are meaningful.
 */
const normalise = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const slug = (normalised) => normalised.replace(/ /g, '_');

/** normalised name -> canonical display name (last duplicate wins). */
const byName = new Map();
/** The CURATED core only (first source), for the AI prompt — see below. */
const core = [];
for (const rel of SOURCES) {
  const text = readFileSync(join(root, rel), 'utf8');
  let hits = 0;
  for (const m of text.matchAll(ENTRY)) {
    const name = unquote(m[1]).trim();
    const muscle = unquote(m[2]).trim();
    const key = normalise(name);
    if (key === '') continue;
    byName.set(key, name);
    if (rel === SOURCES[0]) core.push({ key, name, muscle });
    hits += 1;
  }
  if (hits === 0) {
    console.error(`gen-exercise-ids: ZERO entries parsed from ${rel} — refusing to emit.`);
    process.exit(1);
  }
  console.log(`${rel}: ${hits} entries`);
}

// A guard that can actually fail: distinct normalised names must not slug to
// one id. (They cannot today — slug is injective over [a-z0-9 ] — but the
// normaliser is the kind of thing a later change edits without thinking.)
const idOwner = new Map();
for (const key of byName.keys()) {
  const id = slug(key);
  if (idOwner.has(id)) {
    console.error(
      `gen-exercise-ids: id collision '${id}' between '${idOwner.get(id)}' and '${key}' — refusing to emit.`
    );
    process.exit(1);
  }
  idOwner.set(id, key);
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const keys = [...byName.keys()].sort();
const idLines = keys.map((k) => `  '${esc(k)}': '${esc(slug(k))}',`);
const nameLines = keys.map((k) => `  '${esc(slug(k))}': '${esc(byName.get(k))}',`);

const out = `/**
 * GENERATED — do not hand-edit. Regenerate: node scripts/gen-exercise-ids.mjs
 *
 * The compact canonical-identity projection of EXERCISE_LIBRARY, for the hot
 * paths (set save, previous-set lookup, the set queue) that must not drag the
 * full ~210KB library into the shared boot chunk — the same reason
 * muscle-by-name.generated.ts exists.
 *
 * Keys of EXERCISE_ID_BY_NAME are NORMALISED names (see
 * normaliseExerciseName in exercise-identity.ts); the id is that key with
 * spaces folded to underscores, so it is derivable anywhere — TypeScript,
 * SQL, or an edge function — without shipping this table.
 *
 * Pinned by src/domain/__tests__/exercise-identity.test.ts.
 */

/** normalised exercise name -> permanent canonical exercise id. */
export const EXERCISE_ID_BY_NAME: Readonly<Record<string, string>> = {
${idLines.join('\n')}
};

/** canonical exercise id -> the library's own display name. */
export const CANONICAL_NAME_BY_ID: Readonly<Record<string, string>> = {
${nameLines.join('\n')}
};
`;

writeFileSync(join(root, 'src/domain/exercise-ids.generated.ts'), out);
console.log(`wrote src/domain/exercise-ids.generated.ts (${byName.size} exercises)`);

// ---------------------------------------------------------------------------
// THE EDGE-FUNCTION HALF.
//
// ai-plan runs in Deno and cannot import from client/src, so it gets its own
// copy — GENERATED FROM THE SAME PARSE, in the same run, so the two cannot
// drift. It needs exactly two things and deliberately not a third:
//
//   PLAN_EXERCISES  the ~195 CURATED core lifts, as (id, name, muscle). This
//                   is what goes in the prompt: a model asked to choose from
//                   1,099 names — including the long tail of the imported
//                   dataset — writes worse plans, and the prompt would carry
//                   ~15k tokens of catalogue on every call.
//   EXERCISE_IDS    all 1,099 ids, for VALIDATION. The model may name a lift
//                   outside the core; if the id is real, it is honoured.
//
// It does NOT get the resolver. There is one resolver and it lives in
// client/src/domain/exercise-identity.ts; the edge function only needs to
// answer "is this id real", and anything it cannot answer the client resolves
// on read. A second resolver implementation is exactly the drift this whole
// change exists to remove.
// ---------------------------------------------------------------------------

const coreById = new Map();
for (const c of core) coreById.set(slug(c.key), { name: c.name, muscle: c.muscle });

const planLines = [...coreById.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([id, v]) => `  { id: '${esc(id)}', name: '${esc(v.name)}', muscle: '${esc(v.muscle)}' },`);
const idLines2 = keys.map((k) => `  '${esc(slug(k))}',`);

const edge = `/**
 * GENERATED — do not hand-edit. Regenerate: node scripts/gen-exercise-ids.mjs
 * (from client/). Emitted alongside src/domain/exercise-ids.generated.ts in
 * the SAME run and from the SAME parse, so the edge function and the client
 * can never disagree about which exercise ids exist.
 *
 * EvoForge owns exercise identity; the model owns programming. This file is
 * how that rule reaches ai-plan.
 */

export interface CatalogueExercise {
  id: string;
  name: string;
  muscle: string;
}

/** The curated core — what the model is offered to choose from. */
export const PLAN_EXERCISES: readonly CatalogueExercise[] = [
${planLines.join('\n')}
];

/** Every id in the full library, for validating an out-of-core choice. */
export const EXERCISE_IDS: ReadonlySet<string> = new Set([
${idLines2.join('\n')}
]);

/** The library's own name for an id, when the id is one of the core lifts. */
export const CORE_NAME_BY_ID: Readonly<Record<string, string>> = {
${[...coreById.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, v]) => `  '${esc(id)}': '${esc(v.name)}',`).join('\n')}
};
`;

const edgePath = join(root, '..', 'supabase', 'functions', '_shared', 'exercise-catalogue.ts');
writeFileSync(edgePath, edge);
console.log(`wrote supabase/functions/_shared/exercise-catalogue.ts (${coreById.size} core, ${keys.length} ids)`);
