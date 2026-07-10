/**
 * Token parity guard: src/theme/tokens.js must equal assets/styles.css :root,
 * value for value, both directions.
 *
 *   node scripts/verify-tokens.mjs        exit 0 = every token matches
 *
 * The Streamlit CSS stays live on main throughout the migration, so its :root
 * is the source of truth until cutover. A designer tweaking --accent there must
 * go red here, and a "helpful" adjustment on the client side must go red too.
 *
 * Doctrine (root CLAUDE.md): a guard that cannot fail is not a guard. This one
 * asserts the parsed collection is non-empty (56 tokens expected) before it
 * compares anything, so an empty or moved stylesheet cannot vacuously pass.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tokens = require('../src/theme/tokens.js');

const cssPath = join(here, '..', '..', 'assets', 'styles.css');
const css = readFileSync(cssPath, 'utf-8');

// First :root block only — §15 re-opens :root inside @media 640px to bump the
// desktop type scale; those two overrides are pinned separately below.
const rootMatch = css.match(/:root\s*\{([^}]*)\}/s);
if (!rootMatch) {
  console.error('FAIL: no :root block found in assets/styles.css');
  process.exit(2);
}

const cssTokens = new Map();
for (const m of rootMatch[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  cssTokens.set(m[1], m[2].replace(/\s+/g, ' ').trim());
}

if (cssTokens.size === 0) {
  console.error('FAIL: :root parsed to zero tokens — the guard is not guarding');
  process.exit(2);
}

// Flatten tokens.js back into the CSS custom-property names it mirrors.
const flat = new Map();
const put = (name, value) => flat.set(name, String(value).replace(/\s+/g, ' ').trim());

for (const [k, v] of Object.entries(tokens.colors)) {
  put(k === 'bg' || k === 'text' ? `--${k}` : `--${k}`, v);
}
for (const [k, v] of Object.entries(tokens.spacing)) put(`--${k}`, v);
for (const [k, v] of Object.entries(tokens.radius)) put(`--r-${k}`, v);
for (const [k, v] of Object.entries(tokens.fontSize)) put(`--fs-${k}`, v);
for (const [k, v] of Object.entries(tokens.shadow)) put(`--shadow-${k}`, v);
for (const [k, v] of Object.entries(tokens.glow)) put(`--glow-${k}`, v);
put('--dur-fast', `${tokens.duration.fast}ms`);
put('--dur', `${tokens.duration.base}ms`);
put('--dur-slow', `${tokens.duration.slow}ms`);
put('--ease', `cubic-bezier(${tokens.easing.base.join(', ')})`);
put('--ease-out', `cubic-bezier(${tokens.easing.out.join(', ')})`);

// CSS writes bare leading-dot decimals and omits units nowhere; normalise the
// few notational differences that are not value differences.
const norm = (v) =>
  v
    .replace(/0\.(\d)/g, '.$1') // 0.12 -> .12
    .replace(/,\s*/g, ', ') // comma spacing
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');

const problems = [];

for (const [name, cssValue] of cssTokens) {
  if (!flat.has(name)) {
    problems.push(`missing from tokens.js: ${name}: ${cssValue}`);
  } else if (norm(flat.get(name)) !== norm(cssValue)) {
    problems.push(`value mismatch ${name}: css="${cssValue}" tokens.js="${flat.get(name)}"`);
  }
}
for (const name of flat.keys()) {
  if (!cssTokens.has(name)) {
    problems.push(`extra in tokens.js (not in :root): ${name}`);
  }
}

// The two desktop type-scale overrides in §15.
const media = css.match(/@media \(min-width: 640px\)\s*\{\s*:root\s*\{([^}]*)\}/s);
if (!media) {
  problems.push('missing: the 640px :root override block (--fs-2xl/--fs-3xl)');
} else {
  const overrides = new Map(
    [...media[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );
  for (const [key, cssName] of [
    ['2xl', '--fs-2xl'],
    ['3xl', '--fs-3xl'],
  ]) {
    const want = overrides.get(cssName);
    const have = tokens.fontSizeDesktop[key];
    if (norm(have ?? '') !== norm(want ?? '')) {
      problems.push(`desktop override ${cssName}: css="${want}" tokens.js="${have}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(`FAIL: ${problems.length} token parity problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`OK: ${cssTokens.size} :root tokens + 2 desktop overrides match tokens.js exactly`);
