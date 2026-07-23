// Premium program P2 — the simulation/rendering boundary, enforced.
//
// The arena's deterministic engine (src/arena-game/game-engine/) must stay
// pure TypeScript: no react, react-native, or expo imports, ever. The render
// layer derives everything from engine state + the append-only log; if the
// engine ever imports UI, rendering can start deciding combat and replay
// determinism dies. This guard turns that architecture rule into CI.
//
// Doctrine: a guard that cannot fail is not a guard — the file-count floor
// below ensures we are scanning real engine sources, not an empty glob.
// Falsified 2026-07-23 (react import added to types.ts → red → removed).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(here, '..', 'src', 'arena-game', 'game-engine');
const MIN_FILES = 10;

// Module specifiers the engine must never import (prefix match on the
// specifier, so 'react-native/Libraries/...' and 'expo-router' both trip).
const FORBIDDEN = ['react', 'react-dom', 'react-native', 'expo', '@expo', 'zustand'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = walk(ENGINE_DIR);
if (files.length < MIN_FILES) {
  console.error(
    `verify-arena-purity: only ${files.length} engine files found — the scan is not looking at the real engine.`
  );
  process.exit(1);
}

const IMPORT_RE = /(?:^|\n)\s*(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

let failed = false;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    for (const bad of FORBIDDEN) {
      if (spec === bad || spec.startsWith(`${bad}/`)) {
        console.error(`verify-arena-purity: ${file} imports '${spec}' — the engine must stay pure TS.`);
        failed = true;
      }
    }
  }
}

if (failed) process.exit(1);
console.log(`arena engine purity OK (${files.length} files, no UI imports).`);
