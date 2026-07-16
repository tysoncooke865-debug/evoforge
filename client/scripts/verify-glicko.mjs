// The Glicko-2 maths exists in three places and must be BYTE-IDENTICAL:
//   contracts/rival/glicko2.ts                       (the master — edit this)
//   client/src/domain/progression/glicko2.ts         (display previews)
//   supabase/functions/_shared/rival/glicko2.ts      (authoritative settles)
// The battle-engine doctrine applied to ratings: preview maths that drifts
// from settle maths is a lie on screen. Run with --write to propagate the
// master; CI runs it bare and fails on drift.
//
// A guard that cannot fail is not a guard: non-empty + marker assertions
// below prove we compare real bytes, not three empty files agreeing.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const MASTER = resolve(repo, 'contracts', 'rival', 'glicko2.ts');
const COPIES = [
  resolve(repo, 'client', 'src', 'domain', 'progression', 'glicko2.ts'),
  resolve(repo, 'supabase', 'functions', '_shared', 'rival', 'glicko2.ts'),
];

const master = readFileSync(MASTER, 'utf8');
if (master.length < 1000 || !master.includes('glicko2Update')) {
  console.error('verify-glicko: the master looks wrong (too small or missing glicko2Update)');
  process.exit(1);
}

if (process.argv.includes('--write')) {
  for (const copy of COPIES) {
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, master);
    console.log('wrote', copy);
  }
  process.exit(0);
}

let failed = false;
for (const copy of COPIES) {
  let text;
  try {
    text = readFileSync(copy, 'utf8');
  } catch {
    console.error(`verify-glicko: MISSING copy ${copy}`);
    failed = true;
    continue;
  }
  if (text !== master) {
    console.error(`verify-glicko: DRIFT in ${copy} (run: node scripts/verify-glicko.mjs --write)`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`glicko2 parity OK (${master.length} bytes × ${COPIES.length + 1}).`);
