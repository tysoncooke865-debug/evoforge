// gen-muscle-by-name.mjs — regenerate src/domain/muscle-by-name.generated.ts
//
// WHY THIS EXISTS (perf, 2026-07-23): libraryMuscleFor() is read on every set
// save and by the Home/Train render paths, which put the ENTIRE ~1,100-entry
// EXERCISE_LIBRARY (name/muscle/equipment/category/difficulty/secondary/
// popularity, ~210KB source) into the shared boot chunk every visitor
// downloads. Those callers only ever need name -> muscle. This script emits
// that compact projection; the full library stays behind the picker/builder
// route chunks.
//
// Source of truth is UNCHANGED: CORE_EXERCISES + IMPORTED_EXERCISES. The
// projection is pinned by src/domain/__tests__/muscle-by-name.test.ts, which
// fails on ANY drift — editing the library without rerunning this script is a
// red test, not a silent lie.
//
// Run: node scripts/gen-muscle-by-name.mjs   (from client/)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// EXERCISE_LIBRARY = [...CORE_EXERCISES, ...IMPORTED_EXERCISES] — keep that
// order so duplicate lowercased names resolve the same way (last wins, the
// Map-constructor rule the old inline BY_NAME had).
const SOURCES = [
  'src/domain/exercise-library.ts',
  'src/domain/exercise-library-imported.ts',
];

// A library entry is `{ name: <str>, muscle: <str>, ...` — name IMMEDIATELY
// followed by muscle. That adjacency is what keeps SPLITS/DAY_PRESETS rows
// (which also carry `name:`) out of the match. Either quote style ("Farmer's
// Walk" is double-quoted). The parity test is the real guard; this regex only
// needs to be right when the test is green.
const STR = `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
const ENTRY = new RegExp(`\\{\\s*name:\\s*${STR}\\s*,\\s*muscle:\\s*${STR}`, 'g');

const unquote = (s) => s.slice(1, -1).replace(/\\(['"\\])/g, '$1');

const byName = new Map();
for (const rel of SOURCES) {
  const text = readFileSync(join(root, rel), 'utf8');
  let hits = 0;
  for (const m of text.matchAll(ENTRY)) {
    byName.set(unquote(m[1]).trim().toLowerCase(), unquote(m[2]));
    hits += 1;
  }
  if (hits === 0) {
    console.error(`gen-muscle-by-name: ZERO entries parsed from ${rel} — refusing to emit.`);
    process.exit(1);
  }
  console.log(`${rel}: ${hits} entries`);
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const lines = [...byName.entries()].map(([k, v]) => `  '${esc(k)}': '${esc(v)}',`);

const out = `/**
 * GENERATED — do not hand-edit. Regenerate: node scripts/gen-muscle-by-name.mjs
 *
 * The compact name -> muscle projection of EXERCISE_LIBRARY, for the hot
 * paths (set save, Home/Train cards) that must not drag the full ~210KB
 * library into the shared boot chunk. Keys are trim().toLowerCase() names,
 * last duplicate wins — byte-for-byte the old exercise-library BY_NAME
 * semantics. Pinned by src/domain/__tests__/muscle-by-name.test.ts.
 */

export const MUSCLE_BY_NAME: Readonly<Record<string, string>> = {
${lines.join('\n')}
};
`;

writeFileSync(join(root, 'src/domain/muscle-by-name.generated.ts'), out);
console.log(`wrote src/domain/muscle-by-name.generated.ts (${byName.size} names)`);
