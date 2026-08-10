/**
 * GENERATE THE EVOFORGE ICON FAMILY VIA PIXELLAB.
 *
 *   node scripts/pixellab/generate-icons.mjs            # generate what is missing
 *   node scripts/pixellab/generate-icons.mjs --force    # regenerate everything
 *   node scripts/pixellab/generate-icons.mjs trophy ghost   # just these
 *
 * Needs PIXELLAB_AI_KEY (env, or client/.env.local). Same pipeline, same key
 * and the same terms as the arena champions and the Forge materials — see
 * `src/arena-game/ASSETS.md` and `scripts/forge-materials-gen.mjs`.
 *
 * ---- THE THINGS THIS SCRIPT EXISTS TO GUARANTEE ----
 *
 * 1. THE KEY NEVER SHIPS. It is read at generation time, in Node, from an
 *    env var or a gitignored `.env.local`. It is never `EXPO_PUBLIC_*`, so it
 *    cannot be inlined into the bundle, and nothing in `src/` imports this
 *    file. `validate-icons.mjs` asserts both of those, because "we were
 *    careful" is not a guard.
 * 2. NOTHING IS GENERATED AT RUNTIME. The app reads committed PNGs. There is
 *    no code path from a screen to api.pixellab.ai.
 * 3. A REGENERATION REPRODUCES. Seeds are pinned in the manifest.
 * 4. PROVENANCE IS RECORDED. Every generated file gets a row in
 *    `assets/pixel-lab/icons/manifest.json` — endpoint, prompt, seed, size,
 *    date, what it replaced. An asset whose origin nobody can state is an
 *    asset nobody can regenerate.
 *
 * ---- WHY IT DOES NOT ACCEPT THE FIRST RESULT BLINDLY ----
 *
 * The brief says not to, and it is right: pixflux returns a plausible image for
 * almost any prompt, and "plausible" at 64×64 can still be unreadable at 16px.
 * `--force` regenerates; `validate-icons.mjs` is the automated half of the
 * quality gate (transparency, non-empty, palette sanity, silhouette coverage);
 * the review page (`docs/icon-preview.html`) is the human half. Anything that
 * fails either gets its prompt reworked and its seed bumped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ICONS } from './icon-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..', '..');
const OUT = path.join(CLIENT, 'assets', 'pixel-lab', 'icons');
const MANIFEST = path.join(OUT, 'manifest.json');
const API = 'https://api.pixellab.ai/v1';
const ENDPOINT = '/generate-image-pixflux';

function apiKey() {
  if (process.env.PIXELLAB_AI_KEY) return process.env.PIXELLAB_AI_KEY;
  const envPath = path.join(CLIENT, '.env.local');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/PIXELLAB_AI_KEY\s*=\s*(\S+)/);
    if (m) return m[1];
  }
  throw new Error('PIXELLAB_AI_KEY not found (env or client/.env.local)');
}

async function call(route, body, key) {
  const res = await fetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const stripB64 = (img) => (img.base64 ?? img).replace(/^data:image\/png;base64,/, '');

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const key = apiKey();
const wanted = only.length > 0 ? ICONS.filter((i) => only.includes(i.name)) : ICONS;
if (wanted.length === 0) {
  console.error(`no icons matched ${only.join(', ')}`);
  process.exit(1);
}

const provenance = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
// Passed in rather than read from the clock: a rerun that changes nothing
// should not churn the manifest's dates.
const today = new Date().toISOString().slice(0, 10);

for (const icon of wanted) {
  const dir = path.join(OUT, icon.category);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${icon.name}.png`);
  if (fs.existsSync(file) && !force) {
    console.log(`skip   ${icon.name} (exists)`);
    continue;
  }
  process.stdout.write(`gen    ${icon.name} (${icon.size}px, seed ${icon.seed}) ... `);
  const body = {
    description: icon.desc,
    image_size: { width: icon.size, height: icon.size },
    view: 'side',
    direction: 'south',
    no_background: true,
    seed: icon.seed,
  };
  const json = await call(ENDPOINT, body, key);
  fs.writeFileSync(file, Buffer.from(stripB64(json.image), 'base64'));

  provenance[icon.name] = {
    endpoint: `${API}${ENDPOINT}`,
    model: 'pixflux',
    prompt: icon.desc,
    seed: icon.seed,
    size: `${icon.size}x${icon.size}`,
    transparent: true,
    view: body.view,
    styleReference: 'assets/arena-pixellab-src/champion-shredder.png (EvoForge arena family)',
    palette: 'EvoForge: dark navy base, neon cyan/electric blue, gold/amber for rewards',
    generated: today,
    replaces: icon.replaces ?? null,
    replacedSites: icon.sites ?? [],
    output: path.relative(CLIENT, file).replace(/\\/g, '/'),
    manualCleanup: 'none',
  };
  console.log(`ok  ->  ${provenance[icon.name].output}`);
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`\nwrote ${path.relative(CLIENT, MANIFEST).replace(/\\/g, '/')}`);
console.log('now run: node scripts/pixellab/validate-icons.mjs');
