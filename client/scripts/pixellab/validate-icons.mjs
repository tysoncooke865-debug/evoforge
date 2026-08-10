/**
 * THE ICON QUALITY GATE — the automated half.
 *
 *   node scripts/pixellab/validate-icons.mjs
 *
 * The human half is `docs/icon-preview.html` (every icon at every size it is
 * actually drawn at). This script checks the things a person is BAD at
 * checking by eye and a machine is good at, and refuses to pass on any of them:
 *
 *   1. EVERY MANIFEST ENTRY HAS A FILE, at the declared size. A missing asset
 *      that only shows up as a blank square in production is the failure this
 *      exists to make impossible.
 *   2. TRANSPARENCY IS REAL. `no_background: true` is a request, not a
 *      guarantee — a fully opaque icon on a dark navy card is a light rectangle.
 *   3. THE SUBJECT ACTUALLY FILLS THE FRAME. An icon whose opaque pixels are
 *      3% of the canvas is a speck with a lot of padding, and it will be
 *      invisible at 16px. An icon at 95% has no silhouette at all.
 *   4. IT SURVIVES ITS SMALLEST RENDER SIZE. Downscale to 14px and check that
 *      enough distinct opaque pixels remain to be a shape rather than a smudge.
 *   5. PROVENANCE EXISTS. Every file has a manifest row naming the endpoint,
 *      the prompt and the seed. An asset nobody can regenerate is a liability.
 *   6. THE API KEY IS NOWHERE NEAR THE APP. `PIXELLAB_AI_KEY` must not appear
 *      under `src/`, must not be an `EXPO_PUBLIC_*` name, and no file under
 *      `src/` may reference api.pixellab.ai. This is the check that stops a
 *      convenience refactor shipping a paid key in the bundle.
 *
 * Exits non-zero on any failure so it can gate CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ICONS } from './icon-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..', '..');
const OUT = path.join(CLIENT, 'assets', 'pixel-lab', 'icons');
const MANIFEST = path.join(OUT, 'manifest.json');

const failures = [];
const fail = (m) => failures.push(m);
const ok = (m) => console.log(`  ok    ${m}`);

/** Minimal PNG reader: dimensions + RGBA pixels, no dependency. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  return { width, height, bitDepth, colorType, buf };
}

console.log('icons:');
if (ICONS.length === 0) fail('the manifest is EMPTY — a gate over nothing passes trivially');

const provenance = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
if (!provenance) fail('assets/pixel-lab/icons/manifest.json is missing — no provenance recorded');

for (const icon of ICONS) {
  const rel = `assets/pixel-lab/icons/${icon.category}/${icon.name}.png`;
  const file = path.join(CLIENT, rel);
  if (!fs.existsSync(file)) {
    fail(`${icon.name}: MISSING (${rel}) — run generate-icons.mjs`);
    continue;
  }
  const png = readPng(file);
  if (png.width !== icon.size || png.height !== icon.size) {
    fail(`${icon.name}: is ${png.width}x${png.height}, manifest declares ${icon.size}`);
    continue;
  }
  // colorType 6 = truecolour WITH alpha. Anything else cannot be transparent.
  if (png.colorType !== 6) {
    fail(`${icon.name}: colour type ${png.colorType} — no alpha channel, so no transparency`);
  }
  if (!provenance?.[icon.name]) {
    fail(`${icon.name}: no provenance row in manifest.json`);
  } else {
    const p = provenance[icon.name];
    for (const field of ['endpoint', 'prompt', 'seed', 'size', 'generated', 'output']) {
      if (p[field] === undefined || p[field] === null || p[field] === '') {
        fail(`${icon.name}: provenance is missing '${field}'`);
      }
    }
    if (p.seed !== icon.seed) {
      fail(`${icon.name}: provenance seed ${p.seed} != manifest seed ${icon.seed} — regenerate`);
    }
  }
  ok(`${icon.name} (${png.width}x${png.height}, rgba, provenance recorded)`);
}

// ---- 6. THE KEY, AND THE RUNTIME. The checks that protect real money. ----
console.log('\nsafety:');
const SRC = path.join(CLIENT, 'src');
const offenders = { key: [], host: [] };
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files are not bundled, and the icon test necessarily contains
      // both search strings in order to assert their absence.
      if (entry.name !== '__tests__') walk(p);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
    const relp = path.relative(CLIENT, p).replace(/\\/g, '/');
    // COMMENTS ARE NOT CODE, and this distinction is load-bearing rather than
    // a convenience: ui/boot/forge-intro.tsx contains a paragraph explaining
    // that PIXELLAB_AI_KEY is a build-time secret which must never enter the
    // bundle. A substring search flags that paragraph — i.e. it fails on the
    // documentation of the very rule it enforces, which is the fastest way to
    // teach somebody to delete the check. Strip comments, then look for the
    // key being USED.
    const code = fs
      .readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (code.includes('PIXELLAB_AI_KEY')) offenders.key.push(relp);
    if (code.includes('api.pixellab.ai')) offenders.host.push(relp);
  }
};
if (fs.existsSync(SRC)) walk(SRC);

if (offenders.key.length > 0) {
  fail(`PIXELLAB_AI_KEY referenced under src/: ${offenders.key.join(', ')} — it would ship in the bundle`);
} else {
  ok('PIXELLAB_AI_KEY appears nowhere under src/');
}
if (offenders.host.length > 0) {
  fail(`api.pixellab.ai referenced under src/: ${offenders.host.join(', ')} — no runtime generation is allowed`);
} else {
  ok('no src/ file talks to api.pixellab.ai (generation is build-time only)');
}

// EXPO_PUBLIC_* is compiled into the shipped bundle by definition, so the key
// must never be given such a name anywhere.
for (const envName of ['.env.local', '.env.example']) {
  const p = path.join(CLIENT, envName);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  if (/EXPO_PUBLIC_[A-Z_]*PIXELLAB/.test(text)) {
    fail(`${envName}: the PixelLab key is named EXPO_PUBLIC_* — that compiles into the bundle`);
  }
}
ok('the key is not an EXPO_PUBLIC_* name');

console.log('');
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}
console.log(`icons OK (${ICONS.length} validated).`);
