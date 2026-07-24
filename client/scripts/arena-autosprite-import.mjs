/**
 * Arena 2.0 — AutoSprite import pipeline (Phase P0).
 *
 *   node scripts/arena-autosprite-import.mjs <champion>   # default: shredder
 *
 * Ingests an AutoSprite export (per-clip `spritesheet.png` + `atlas.json`,
 * 128px cells) from assets/arena-autosprite-src/<champion>/<clip>/, VALIDATES
 * it (the brief's "reject inconsistent sprites"), normalizes every clip to a
 * shared feet-anchor, pngquant-crushes the sheets into the arena2 sprite dir,
 * and emits the runtime metadata content/champion-anim/<champion>.anim.json
 * that the AnimationController + atlas-sprite renderer read.
 *
 * This is pure post-processing (no network). Benchmark provenance: the
 * ShredderL4 AutoSprite set (see ARENA_2.0_REDESIGN.md §2 / ASSETS.md).
 *
 * Atlas format (TexturePacker-style hash): { "frames": { "<i>": {x,y,w,h,duration} } }
 * — uniform `duration`; per-clip timing (fps/loop) is authored here, not in the atlas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..');
const CELL = 128;
const ALPHA_FG = 24;
/** Hard reject if a clip's feet sit more than this far from the reference. */
const MAX_ANCHOR_DRIFT = 40;

/** Canonical clip set + authored playback (fps + loop). Folder names are the
 *  normalized clip ids the copy step produced. */
const CLIP_SPEC = {
  idle: { fps: 12, loop: true },
  run: { fps: 30, loop: true },
  attack: { fps: 30, loop: false, hitFrameFrac: 0.5 },
  hit: { fps: 24, loop: false },
  dash: { fps: 30, loop: false, iFrames: [0.1, 0.7] },
  ultimate: { fps: 20, loop: false, hitFrameFrac: 0.45 },
};
const REQUIRED_CLIPS = Object.keys(CLIP_SPEC);
/** The clip whose feet baseline defines the champion's ground reference. */
const REF_CLIP = 'idle';

function readAtlas(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!json.frames || typeof json.frames !== 'object') throw new Error(`bad atlas: ${file}`);
  const entries = Object.entries(json.frames)
    .map(([k, v]) => [Number(k), v])
    .sort((a, b) => a[0] - b[0]);
  return entries.map(([, v]) => v);
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Per-frame content bbox → the clip's feet baseline (median max-opaque-Y,
 *  robust to a loud VFX frame) and its typical footprint width (median, so a
 *  few wide-VFX frames like the ultimate streak don't count as the body). */
function measure(png, cols, count) {
  const feet = [];
  const widths = [];
  for (let i = 0; i < count; i++) {
    const cx = (i % cols) * CELL;
    const cy = Math.floor(i / cols) * CELL;
    let minX = CELL, maxX = -1, maxY = -1;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const a = png.data[((cy + y) * png.width + (cx + x)) * 4 + 3];
        if (a > ALPHA_FG) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxY >= 0) {
      feet.push(maxY);
      widths.push(maxX - minX + 1);
    }
  }
  return { feetY: feet.length ? median(feet) : CELL - 1, medianWidth: median(widths) };
}

function cornerTransparent(png) {
  const idx = (x, y) => png.data[(y * png.width + x) * 4 + 3];
  return idx(0, 0) <= ALPHA_FG && idx(png.width - 1, 0) <= ALPHA_FG;
}

function importChampion(champion) {
  const srcDir = path.join(CLIENT, 'assets', 'arena-autosprite-src', champion);
  const outSpriteDir = path.join(CLIENT, 'src', 'arena-game', 'features', 'arena2', 'sprites', champion);
  const metaFile = path.join(CLIENT, 'src', 'arena-game', 'content', 'champion-anim', `${champion}.anim.json`);
  fs.mkdirSync(outSpriteDir, { recursive: true });
  fs.mkdirSync(path.dirname(metaFile), { recursive: true });

  const errors = [];
  const raw = {}; // clip -> {cols, rows, count, feetY, maxWidth, sheetW, sheetH}

  for (const clip of REQUIRED_CLIPS) {
    const clipDir = path.join(srcDir, clip);
    const atlasFile = path.join(clipDir, 'atlas.json');
    const sheetFile = path.join(clipDir, 'spritesheet.png');
    if (!fs.existsSync(atlasFile) || !fs.existsSync(sheetFile)) {
      errors.push(`${clip}: missing atlas.json or spritesheet.png`);
      continue;
    }
    const frames = readAtlas(atlasFile);
    const png = PNG.sync.read(fs.readFileSync(sheetFile));
    // Validate: 128 cells, sheet multiple of 128, row-major packing.
    if (png.width % CELL !== 0 || png.height % CELL !== 0) {
      errors.push(`${clip}: sheet ${png.width}x${png.height} not a multiple of ${CELL}`);
      continue;
    }
    const cols = png.width / CELL;
    let rowMajor = true;
    frames.forEach((f, i) => {
      if (f.w !== CELL || f.h !== CELL) rowMajor = false;
      if (f.x !== (i % cols) * CELL || f.y !== Math.floor(i / cols) * CELL) rowMajor = false;
    });
    if (!rowMajor) {
      errors.push(`${clip}: atlas is not 128px row-major packed (unsupported layout)`);
      continue;
    }
    if (!cornerTransparent(png)) errors.push(`${clip}: sheet corners are not transparent`);
    const { feetY, medianWidth } = measure(png, cols, frames.length);
    raw[clip] = { cols, rows: png.height / CELL, count: frames.length, feetY, medianWidth, sheetW: png.width, sheetH: png.height };
    // pngquant the sheet into the arena2 sprite dir.
    const outSheet = path.join(outSpriteDir, `${clip}.png`);
    fs.writeFileSync(outSheet, PNG.sync.write(png));
  }

  if (!raw[REF_CLIP]) errors.push(`missing reference clip '${REF_CLIP}' — cannot set ground anchor`);
  const refFeetY = raw[REF_CLIP]?.feetY ?? CELL - 1;

  const clips = {};
  for (const clip of REQUIRED_CLIPS) {
    const r = raw[clip];
    if (!r) continue;
    const anchorYOffset = r.feetY - refFeetY; // >0 => feet sit lower; shift sprite UP by this at render
    if (Math.abs(anchorYOffset) > MAX_ANCHOR_DRIFT) {
      errors.push(`${clip}: feet drift ${anchorYOffset}px exceeds ${MAX_ANCHOR_DRIFT}px (bad export)`);
    }
    // Typical (median) body width — a few wide-VFX frames are expected and fine;
    // a large median means the character itself is mis-scaled for the cell.
    if (r.medianWidth > 110) errors.push(`${clip}: typical footprint ${r.medianWidth}px too wide (character mis-scaled?)`);
    clips[clip] = {
      sheet: `${clip}.png`,
      cols: r.cols,
      rows: r.rows,
      count: r.count,
      cell: CELL,
      fps: CLIP_SPEC[clip].fps,
      loop: CLIP_SPEC[clip].loop,
      anchorYOffset,
      ...(CLIP_SPEC[clip].hitFrameFrac != null
        ? { hitFrame: Math.round((r.count - 1) * CLIP_SPEC[clip].hitFrameFrac) }
        : {}),
      ...(CLIP_SPEC[clip].iFrames
        ? { iFrames: CLIP_SPEC[clip].iFrames.map((f) => Math.round((r.count - 1) * f)) }
        : {}),
    };
  }

  if (errors.length) {
    console.error(`REJECTED ${champion} — inconsistent sprites:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const meta = { champion, cell: CELL, refFeetY, clips };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  console.log(`imported ${champion}: ${Object.keys(clips).length} clips -> ${path.relative(CLIENT, metaFile)}`);
  console.log(`  refFeetY=${refFeetY}  ` + Object.entries(clips).map(([k, v]) => `${k}(${v.count}f,${v.anchorYOffset >= 0 ? '+' : ''}${v.anchorYOffset})`).join('  '));
  // Crush the emitted sheets (best-effort; identical rule to the other pipelines).
  try {
    execFileSync('pngquant', ['--force', '--skip-if-larger', '--ext', '.png', ...fs.readdirSync(outSpriteDir).filter((f) => f.endsWith('.png')).map((f) => path.join(outSpriteDir, f))], { stdio: 'ignore' });
    console.log('  crushed sheets with pngquant');
  } catch {
    console.log('  (pngquant unavailable — sheets left uncrushed)');
  }
}

const champion = process.argv[2] ?? 'shredder';
importChampion(champion);
