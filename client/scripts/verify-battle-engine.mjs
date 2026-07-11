// The battle engine exists in three places and must be BYTE-IDENTICAL:
//   contracts/battle/engine.ts                     (the master — edit this)
//   client/src/domain/battle/engine.ts             (display previews)
//   supabase/functions/_shared/battle/engine.ts    (authoritative scoring)
// verify-tokens.mjs applied to logic: a drift between the client's preview
// math and the server's authoritative math is a lie on screen. Run with
// --write to propagate the master; CI runs it bare and fails on drift.
//
// Doctrine: a guard that cannot fail is not a guard — the non-empty and
// marker assertions below make sure we are comparing real engine bytes,
// not three empty files agreeing with each other.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const MASTER = resolve(repo, 'contracts', 'battle', 'engine.ts');
const COPIES = [
  resolve(repo, 'client', 'src', 'domain', 'battle', 'engine.ts'),
  resolve(repo, 'supabase', 'functions', '_shared', 'battle', 'engine.ts'),
];

const master = readFileSync(MASTER, 'utf8');
if (master.length < 1000 || !master.includes('scoreStrengthRound')) {
  console.error('verify-battle-engine: master looks wrong (too small or missing engine).');
  process.exit(1);
}

if (process.argv.includes('--write')) {
  for (const copy of COPIES) {
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, master, 'utf8');
    console.log(`wrote ${copy}`);
  }
  console.log('battle engine propagated.');
  process.exit(0);
}

let failed = false;
for (const copy of COPIES) {
  let text;
  try {
    text = readFileSync(copy, 'utf8');
  } catch {
    console.error(`verify-battle-engine: MISSING copy ${copy}`);
    failed = true;
    continue;
  }
  if (text !== master) {
    console.error(`verify-battle-engine: ${copy} DIFFERS from the master. Edit contracts/battle/engine.ts and run with --write.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`battle engine parity OK (${master.length} bytes × 3).`);
