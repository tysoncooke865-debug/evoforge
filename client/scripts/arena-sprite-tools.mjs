/**
 * Arena sprite tooling for the Kenney 1-Bit Pack (CC0) sheet — the slicing
 * pipeline copied from the standalone evoforge-arena repo, re-pointed at
 * this repo's paths (see src/arena-game/ASSETS.md for provenance).
 *
 *   node scripts/arena-sprite-tools.mjs preview <col0> <row0> <cols> <rows>
 *     → writes assets/arena-pixel-src/preview.png: the region scaled 6x on a
 *       dark background with a grid, for choosing tiles visually.
 *
 *   node scripts/arena-sprite-tools.mjs build
 *     → slices the tiles listed in SPRITES, tints them into the EvoForge
 *       palette variants, and writes game-ready PNGs to
 *       src/arena-game/features/arena/sprites/.
 *
 * Sheet: assets/arena-pixel-src/kenney-1bit-monochrome.png — 49x22 tiles of
 * 16px, white shapes on transparent. Uses pngjs (present in node_modules).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILE = 16;
const SHEET = path.join(__dirname, '..', 'assets', 'arena-pixel-src', 'kenney-1bit-monochrome.png');
const OUT_DIR = path.join(__dirname, '..', 'src', 'arena-game', 'features', 'arena', 'sprites');
const PREVIEW = path.join(__dirname, '..', 'assets', 'arena-pixel-src', 'preview.png');

/** EvoForge palette (mirrors src/arena-game/constants/theme.ts — keep in sync). */
const COLORS = {
  player: [0x22, 0xd3, 0xee], // cyan
  opponent: [0xf8, 0x71, 0x71], // red
  aesthetic: [0x34, 0xd3, 0x99],
  titan: [0xf5, 0x9e, 0x0b],
  mass: [0xe8, 0x79, 0xf9],
  shredder: [0xa7, 0x8b, 0xfa],
  cardio: [0x22, 0xd3, 0xee],
  neutral: [0xe6, 0xf1, 0xff],
};

/**
 * Tile assignments (col,row on the sheet) — chosen visually via `preview`.
 * Every fighter card art key + the five official champions + the forge core.
 * Champion variants are their Avatar Path slugs (sprites.ts key format:
 * `<artKey>--<variant>`).
 */
const SPRITES = {
  recruit: { col: 34, row: 0, variants: ['player', 'opponent'] },
  'titan-guard': { col: 24, row: 1, variants: ['player', 'opponent'] },
  'neon-boxer': { col: 31, row: 0, variants: ['player', 'opponent'] },
  'cardio-runner': { col: 29, row: 4, variants: ['player', 'opponent'] },
  'shadow-striker': { col: 24, row: 2, variants: ['player', 'opponent'] },
  'drone-archer': { col: 31, row: 5, variants: ['player', 'opponent'] },
  'cyber-medic': { col: 26, row: 1, variants: ['player', 'opponent'] },
  'heavy-tank': { col: 30, row: 6, variants: ['player', 'opponent'] },
  'support-drone': { col: 31, row: 4, variants: ['player', 'opponent'] },
  'blade-runner': { col: 27, row: 0, variants: ['player', 'opponent'] },
  'champion-aesthetic': { col: 28, row: 1, variants: ['aesthetic'] },
  'champion-titan': { col: 27, row: 2, variants: ['titan'] },
  // Mass Monster: the broad armoured hulk two tiles right of the Titan pick —
  // widest silhouette in the character block (survey 2026-07-23), clearly
  // bulkier than the Titan's tile.
  'champion-mass': { col: 29, row: 2, variants: ['mass'] },
  'champion-shredder': { col: 25, row: 1, variants: ['shredder'] },
  'champion-cardio': { col: 29, row: 0, variants: ['cardio'] },
  'forge-core': { col: 4, row: 19, variants: ['player', 'opponent'] },
};

function loadSheet() {
  return PNG.sync.read(fs.readFileSync(SHEET));
}

function tileAt(sheet, col, row) {
  const out = new PNG({ width: TILE, height: TILE });
  PNG.bitblt(sheet, out, col * TILE, row * TILE, TILE, TILE, 0, 0);
  return out;
}

/** Recolors white/gray pixels to `rgb`, preserving alpha shape. */
function tint(tile, rgb) {
  const out = new PNG({ width: tile.width, height: tile.height });
  tile.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] > 0) {
      // Scale by original luminance so anti-aliased edges keep their weight.
      const lum = out.data[i] / 255;
      out.data[i] = Math.round(rgb[0] * lum);
      out.data[i + 1] = Math.round(rgb[1] * lum);
      out.data[i + 2] = Math.round(rgb[2] * lum);
    }
  }
  return out;
}

/** Nearest-neighbour upscale (pixel-art safe). */
function scale(tile, factor) {
  const out = new PNG({ width: tile.width * factor, height: tile.height * factor });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const src = (Math.floor(y / factor) * tile.width + Math.floor(x / factor)) * 4;
      const dst = (y * out.width + x) * 4;
      tile.data.copy(out.data, dst, src, src + 4);
    }
  }
  return out;
}

function preview(col0, row0, cols, rows) {
  const sheet = loadSheet();
  const F = 6;
  const cell = TILE * F + 4;
  const out = new PNG({ width: cols * cell, height: rows * cell });
  // Dark background.
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 0x10;
    out.data[i + 1] = 0x18;
    out.data[i + 2] = 0x28;
    out.data[i + 3] = 255;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = scale(tint(tileAt(sheet, col0 + c, row0 + r), COLORS.neutral), F);
      PNG.bitblt(tile, out, 0, 0, tile.width, tile.height, c * cell + 2, r * cell + 2);
    }
  }
  fs.writeFileSync(PREVIEW, PNG.sync.write(out));
  console.log(
    `preview: cols ${col0}..${col0 + cols - 1}, rows ${row0}..${row0 + rows - 1} -> ${PREVIEW}`
  );
}

function build() {
  const sheet = loadSheet();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const [key, spec] of Object.entries(SPRITES)) {
    for (const variant of spec.variants) {
      // 4x pre-scale keeps rendering crisp at ~24-40pt without relying on
      // per-platform image filtering settings.
      const img = scale(tint(tileAt(sheet, spec.col, spec.row), COLORS[variant]), 4);
      const file = `${key}--${variant}.png`;
      fs.writeFileSync(path.join(OUT_DIR, file), PNG.sync.write(img));
      manifest.push(file);
    }
  }
  console.log(`built ${manifest.length} sprites -> ${OUT_DIR}`);
}

const [, , cmd, ...args] = process.argv;
if (cmd === 'preview') preview(...args.map(Number));
else if (cmd === 'build') build();
else console.log('usage: arena-sprite-tools.mjs preview <col0> <row0> <cols> <rows> | build');
