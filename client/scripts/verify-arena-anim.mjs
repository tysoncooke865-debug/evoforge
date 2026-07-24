/**
 * Arena 2.0 — champion animation validation gate (Redesign P0).
 *
 *   node scripts/verify-arena-anim.mjs
 *
 * Validates every imported champion's `content/champion-anim/<c>.anim.json`
 * against the runtime contract the AnimationController + atlas-sprite renderer
 * depend on, and that its sheets exist on disk with dimensions matching the
 * metadata. This is the "reject inconsistent sprites" guard from the brief,
 * enforced in CI. Follows the repo guard doctrine: it asserts NON-EMPTY inputs
 * (a guard that cannot fail is not a guard) and exits non-zero on any problem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..');
const ANIM_DIR = path.join(CLIENT, 'src', 'arena-game', 'content', 'champion-anim');
const SPRITE_ROOT = path.join(CLIENT, 'src', 'arena-game', 'features', 'arena2', 'sprites');
const REQUIRED_CLIPS = ['idle', 'run', 'attack', 'hit', 'dash', 'ultimate'];
const CELL = 128;
const MAX_ANCHOR_DRIFT = 40;

const errors = [];
const fail = (m) => errors.push(m);

if (!fs.existsSync(ANIM_DIR)) fail(`missing anim dir: ${path.relative(CLIENT, ANIM_DIR)}`);
const metaFiles = fs.existsSync(ANIM_DIR)
  ? fs.readdirSync(ANIM_DIR).filter((f) => f.endsWith('.anim.json'))
  : [];
// Guard-that-can-fail: there must be at least one champion to validate.
if (metaFiles.length === 0) fail('no <champion>.anim.json files found — nothing to validate');

let clipsChecked = 0;
for (const file of metaFiles) {
  const full = path.join(ANIM_DIR, file);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    fail(`${file}: not valid JSON (${e.message})`);
    continue;
  }
  const who = meta.champion || file;
  if (meta.cell !== CELL) fail(`${who}: cell=${meta.cell}, expected ${CELL}`);
  if (!Number.isFinite(meta.refFeetY)) fail(`${who}: refFeetY not a number`);
  if (!meta.clips || typeof meta.clips !== 'object') {
    fail(`${who}: no clips`);
    continue;
  }
  for (const clip of REQUIRED_CLIPS) {
    const c = meta.clips[clip];
    if (!c) {
      fail(`${who}: missing required clip '${clip}'`);
      continue;
    }
    for (const k of ['cols', 'rows', 'count', 'cell', 'fps', 'anchorYOffset']) {
      if (!Number.isFinite(c[k])) fail(`${who}.${clip}: '${k}' not a number`);
    }
    if (typeof c.loop !== 'boolean') fail(`${who}.${clip}: 'loop' not boolean`);
    if (c.count <= 0 || c.cols <= 0 || c.rows <= 0) fail(`${who}.${clip}: non-positive grid/count`);
    if (c.count > c.cols * c.rows) fail(`${who}.${clip}: count ${c.count} exceeds grid ${c.cols}x${c.rows}`);
    if (Math.abs(c.anchorYOffset) > MAX_ANCHOR_DRIFT)
      fail(`${who}.${clip}: anchorYOffset ${c.anchorYOffset} exceeds ${MAX_ANCHOR_DRIFT}`);
    if (c.hitFrame != null && (c.hitFrame < 0 || c.hitFrame >= c.count))
      fail(`${who}.${clip}: hitFrame ${c.hitFrame} out of range`);
    // Sheet must exist and match the declared grid.
    const sheetPath = path.join(SPRITE_ROOT, who, c.sheet);
    if (!fs.existsSync(sheetPath)) {
      fail(`${who}.${clip}: sheet not found (${path.relative(CLIENT, sheetPath)})`);
      continue;
    }
    try {
      const png = PNG.sync.read(fs.readFileSync(sheetPath));
      if (png.width !== c.cols * CELL || png.height !== c.rows * CELL)
        fail(`${who}.${clip}: sheet ${png.width}x${png.height} != grid ${c.cols * CELL}x${c.rows * CELL}`);
    } catch (e) {
      fail(`${who}.${clip}: unreadable sheet (${e.message})`);
    }
    clipsChecked++;
  }
}

if (errors.length) {
  console.error(`arena-anim validation FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`arena-anim OK: ${metaFiles.length} champion(s), ${clipsChecked} clips validated.`);
