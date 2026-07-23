/**
 * Arena "Marksman" mob sprite build — slices the externally-supplied
 * mad-max marksman sheet into the drone-archer (Javelin Marksman) unit's
 * per-animation frames, then applies the SAME team-colored outline the
 * PixelLab pipeline uses (arena-pixellab-gen.mjs) and the same pngquant crush.
 *
 *   node scripts/arena-madmog-gen.mjs build   # sheet -> team-outlined 64px frames
 *
 * Pure post-processing, no network. Source of record:
 *   assets/arena-madmog-src/madmog-streamavatars.png  (25x11 grid, 256px cells)
 * Provenance: user-supplied third-party sprite sheet (see ASSETS.md) — this is
 * the ONE arena combatant not generated through PixelLab, so it has its own
 * committed slicer instead of a MANIFEST entry. The art-bible team rule still
 * holds: art is neutral, the 2px dilated outline (+ base plate/health bar/
 * chevron) carries the team; the character's red palette is its identity.
 *
 * Row map (identified by inspecting the sheet, see ASSETS.md):
 *   r5  side-view ranged attack (firing cycle)   -> 'attack'  (one-shot)
 *   r6  top-down death / gib                       -> 'death'   (one-shot)
 *   r8  front-facing walk (toward camera)          -> canonical still (frame 0)
 *   r9  front-facing run  (toward camera)          -> 'toward'  (loop)
 *   r10 back-facing  run  (away from camera)       -> 'away'    (loop)
 * The vertical lane faces player units away (up-screen) and opponent units
 * toward (down-screen), so 'toward'/'away' select by team at render time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..');
const SRC = path.join(CLIENT, 'assets', 'arena-madmog-src', 'madmog-streamavatars.png');
const OUT_DIR = path.join(CLIENT, 'src', 'arena-game', 'features', 'arena', 'sprites', 'px');

const ART_KEY = 'drone-archer';
const CELL = 256;
const TARGET = 64;
const MARGIN = 2; // px of headroom/footroom inside the 64 canvas
const ALPHA_FG = 16; // alpha above this counts as foreground content

/** Team outline colors (mirrors arena theme colors.player / colors.opponent). */
const TEAM_RGB = { player: [0x22, 0xd3, 0xee], opponent: [0xf8, 0x71, 0x71] };

/** Even sample of F frame indices from a row of N cells.
 *  loop=true  -> no endpoint (frame F-1 !== frame 0 for a seamless cycle)
 *  loop=false -> includes the final frame (a one-shot that plays to the end) */
function sampleCols(n, f, loop) {
  const out = [];
  for (let k = 0; k < f; k++) {
    out.push(loop ? Math.round((k * n) / f) % n : Math.round((k * (n - 1)) / (f - 1)));
  }
  return out;
}

const ANIMS = [
  { name: 'toward', row: 9, cols: sampleCols(25, 8, true), kind: 'upright' },
  { name: 'away', row: 10, cols: sampleCols(25, 8, true), kind: 'upright' },
  { name: 'attack', row: 5, cols: sampleCols(25, 8, false), kind: 'upright' },
  { name: 'death', row: 6, cols: sampleCols(24, 8, false), kind: 'death' },
];
/** The canonical still (card thumbnail + fallback): a clean front-facing frame. */
const STILL = { row: 8, col: 0 };

function readSheet() {
  if (!fs.existsSync(SRC)) throw new Error(`source sheet missing: ${SRC}`);
  return PNG.sync.read(fs.readFileSync(SRC));
}

/** Content bounding box (alpha > ALPHA_FG) of one cell, in sheet coordinates. */
function cellBBox(sheet, row, col) {
  const x0 = col * CELL;
  const y0 = row * CELL;
  let minX = CELL, minY = CELL, maxX = -1, maxY = -1;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const a = sheet.data[((y0 + y) * sheet.width + (x0 + x)) * 4 + 3];
      if (a > ALPHA_FG) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Area-average downscale of a sheet sub-rectangle into a `sw`x`sh` buffer,
 * premultiplied so transparent edges don't bleed dark halos, then place
 * bottom-aligned (upright: feet on a consistent baseline) or centered
 * (death: a lying body) into a fresh TARGETxTARGET RGBA PNG.
 */
function renderFrame(sheet, box, scale, bottomAlign) {
  const nw = Math.max(1, Math.round(box.w * scale));
  const nh = Math.max(1, Math.round(box.h * scale));
  const out = new PNG({ width: TARGET, height: TARGET });
  out.data.fill(0);
  const ox = Math.round((TARGET - nw) / 2);
  const oy = bottomAlign ? TARGET - MARGIN - nh : Math.round((TARGET - nh) / 2);
  for (let ty = 0; ty < nh; ty++) {
    const sy0 = box.y + (ty * box.h) / nh;
    const sy1 = box.y + ((ty + 1) * box.h) / nh;
    for (let tx = 0; tx < nw; tx++) {
      const sx0 = box.x + (tx * box.w) / nw;
      const sx1 = box.x + ((tx + 1) * box.w) / nw;
      let ar = 0, ag = 0, ab = 0, aa = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const cy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (cy <= 0 || sy < 0 || sy >= sheet.height) continue;
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const cx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (cx <= 0 || sx < 0 || sx >= sheet.width) continue;
          const w = cx * cy;
          const i = (sy * sheet.width + sx) * 4;
          const a = sheet.data[i + 3] / 255;
          ar += sheet.data[i] * a * w;
          ag += sheet.data[i + 1] * a * w;
          ab += sheet.data[i + 2] * a * w;
          aa += a * w;
          wsum += w;
        }
      }
      const dx = ox + tx;
      const dy = oy + ty;
      if (dx < 0 || dy < 0 || dx >= TARGET || dy >= TARGET) continue;
      const d = (dy * TARGET + dx) * 4;
      if (aa > 1e-6) {
        out.data[d] = Math.round(ar / aa);
        out.data[d + 1] = Math.round(ag / aa);
        out.data[d + 2] = Math.round(ab / aa);
        out.data[d + 3] = Math.round((aa / wsum) * 255);
      }
    }
  }
  return out;
}

/** 2px dilated team-colored outline behind the sprite — byte-identical rule to
 *  arena-pixellab-gen.mjs's outline() so this mob reads exactly like the rest. */
function outline(png, rgb, thickness = 2) {
  const { width, height } = png;
  const out = new PNG({ width, height });
  png.data.copy(out.data);
  const solidAt = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && png.data[(y * width + x) * 4 + 3] > 40;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (png.data[i + 3] > 40) continue;
      let near = false;
      for (let dy = -thickness; dy <= thickness && !near; dy++) {
        for (let dx = -thickness; dx <= thickness && !near; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= thickness && solidAt(x + dx, y + dy)) near = true;
        }
      }
      if (near) {
        out.data[i] = rgb[0];
        out.data[i + 1] = rgb[1];
        out.data[i + 2] = rgb[2];
        out.data[i + 3] = 235;
      }
    }
  }
  return out;
}

const blankFrame = () => {
  const b = new PNG({ width: TARGET, height: TARGET });
  b.data.fill(0);
  return b;
};

/** Write both team-outlined copies for a registry key. `suffix` is the walk/
 *  anim tag (''; e.g. 'toward0') — files land as `<artKey>--<team>[--suffix]`,
 *  matching sprites.ts's `${artKey}--${team}[--w${i}]` naming. */
function writeTeamed(suffix, frame) {
  for (const team of ['player', 'opponent']) {
    const img = outline(frame, TEAM_RGB[team]);
    const tag = suffix ? `--${suffix}` : '';
    fs.writeFileSync(path.join(OUT_DIR, `${ART_KEY}--${team}${tag}.png`), PNG.sync.write(img));
  }
}

function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sheet = readSheet();

  // Shared upright scale = the standing height of the still frame, so the
  // marksman never resizes between walk/attack; each frame bottom-aligns to
  // its OWN feet so the baseline stays put even as the pose changes.
  const stillBox = cellBBox(sheet, STILL.row, STILL.col);
  if (!stillBox) throw new Error('still frame is empty — sheet layout changed?');
  const uprightScale = (TARGET - MARGIN * 2) / stillBox.h;

  // Canonical still (overwrites the old PixelLab javelin thrower).
  writeTeamed('', renderFrame(sheet, stillBox, uprightScale, true));
  let count = 2;

  for (const anim of ANIMS) {
    // Death is a top-down lying body: its own scale (fit its tallest frame),
    // centered rather than standing on the baseline.
    let scale = uprightScale;
    let bottomAlign = true;
    if (anim.kind === 'death') {
      const maxH = Math.max(...anim.cols.map((c) => cellBBox(sheet, anim.row, c)?.h ?? 0), 1);
      scale = (TARGET - MARGIN * 2) / maxH;
      bottomAlign = false;
    }
    anim.cols.forEach((col, i) => {
      const box = cellBBox(sheet, anim.row, col);
      // A trailing empty gib frame becomes a blank so the death fades to nothing.
      const frame = box ? renderFrame(sheet, box, scale, bottomAlign) : blankFrame();
      writeTeamed(`${anim.name}${i}`, frame);
      count += 2;
    });
  }

  console.log(`built ${count} marksman frames -> ${OUT_DIR}`);
  console.log(
    'now crush them:  npx pngquant --force --ext .png src/arena-game/features/arena/sprites/px/drone-archer*.png'
  );
}

const cmd = process.argv[2];
if (cmd === 'build') build();
else console.log('usage: arena-madmog-gen.mjs build');
