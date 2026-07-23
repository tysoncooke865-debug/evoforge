/**
 * Arena pixel-art generation via PixelLab (polish pass Phases 2-3).
 *
 *   node scripts/arena-pixellab-gen.mjs generate   # API calls -> raw 64px sprites
 *   node scripts/arena-pixellab-gen.mjs animate    # API calls -> champion walk frames
 *   node scripts/arena-pixellab-gen.mjs build      # raw -> team-outlined game PNGs
 *   node scripts/arena-pixellab-gen.mjs all
 *
 * `generate` needs PIXELLAB_AI_KEY (env or client/.env.local) and is
 * idempotent per raw file — delete a raw PNG to regenerate it. `build` is
 * pure post-processing (no network): adds a team-colored outline variant per
 * side and writes to src/arena-game/features/arena/sprites/px/. Seeds are
 * pinned so a regeneration is reproducible.
 *
 * Provenance: AI-generated via pixellab.ai under Tyson's API key
 * (see src/arena-game/ASSETS.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..');
const RAW_DIR = path.join(CLIENT, 'assets', 'arena-pixellab-src');
const OUT_DIR = path.join(CLIENT, 'src', 'arena-game', 'features', 'arena', 'sprites', 'px');
const API = 'https://api.pixellab.ai/v1';

/** Team outline colors (mirrors arena theme colors.player / colors.opponent). */
const TEAM_RGB = { player: [0x22, 0xd3, 0xee], opponent: [0xf8, 0x71, 0x71] };

const STYLE =
  'pixel art game sprite, dark cyberpunk gym world, strong readable silhouette, dark outline, ' +
  'detailed shading, centered full body';

/**
 * Asset manifest. kind:
 *  - 'unit'      -> outline variants for both teams
 *  - 'champion'  -> outline variants for both teams (path colors baked in art)
 *  - 'plain'     -> single raw copy, no outline (cores, floor)
 */
const MANIFEST = {
  // --- the five official champions (distinct physiques per identity) ---
  'champion-aesthetic': {
    kind: 'champion',
    seed: 11,
    desc:
      'sleek athletic bodybuilder champion with flawless proportions, emerald green and gold ' +
      'trimmed bodysuit, elegant confident stance, clean precise design, ' + STYLE,
  },
  'champion-titan': {
    kind: 'champion',
    seed: 7,
    desc:
      'hulking gym champion, massive powerlifter physique, amber and dark steel armor with ' +
      'glowing seams, wide heavy stance, ' + STYLE,
  },
  'champion-mass': {
    kind: 'champion',
    seed: 13,
    desc:
      'colossal wide-bodied strongman champion, extremely broad shoulders and enormous bulk, ' +
      'fuchsia magenta and dark armor plates, towering oppressive presence, ' + STYLE,
  },
  'champion-shredder': {
    kind: 'champion',
    seed: 17,
    desc:
      'lean shredded assassin champion, razor-defined muscles, violet and crimson blade-edged ' +
      'suit, aggressive forward-leaning stance, sharp angular design, ' + STYLE,
  },
  'champion-cardio': {
    kind: 'champion',
    seed: 19,
    desc:
      'lean endurance runner champion, sprinter physique, indigo and electric blue speed suit ' +
      'with glowing momentum lines, dynamic ready-to-run stance, ' + STYLE,
  },
  // --- the ten fighter-card units ---
  recruit: {
    kind: 'unit',
    seed: 21,
    desc: 'small rookie gym fighter, simple gray training gear with teal accents, eager stance, ' + STYLE,
  },
  'titan-guard': {
    kind: 'unit',
    seed: 23,
    desc: 'armored heavy guard with tower shield, amber-trimmed dark plate armor, ' + STYLE,
  },
  'neon-boxer': {
    kind: 'unit',
    seed: 27,
    desc: 'boxer with glowing neon gloves, athletic build, fighting stance, ' + STYLE,
  },
  // P8 identity fix: the first generation read as a motorbike at 26pt —
  // explicitly a HUMAN sprinter now (seed bumped to re-roll).
  'cardio-runner': {
    kind: 'unit',
    seed: 30,
    desc:
      'human athlete sprinting upright, runner in a racing singlet with glowing shoes and ' +
      'headband, arms pumping, clearly a person running, ' + STYLE,
  },
  'shadow-striker': {
    kind: 'unit',
    seed: 31,
    desc: 'hooded assassin with twin energy daggers, dark cloak with purple glow, crouched, ' + STYLE,
  },
  // P8 identity fix: the card is "Javelin Marksman" — a thrower, not a
  // drone (the art key predates the fitness-terminology rename).
  'drone-archer': {
    kind: 'unit',
    seed: 38,
    desc:
      'athletic javelin thrower winding up to hurl a glowing energy javelin, track and field ' +
      'athlete physique, throwing stance, ' + STYLE,
  },
  'cyber-medic': {
    kind: 'unit',
    seed: 41,
    desc: 'field medic with glowing green energy staff and medkit, white and green techwear, ' + STYLE,
  },
  'heavy-tank': {
    kind: 'unit',
    seed: 43,
    desc: 'bulky walking mech tank with thick armor plates and pistons, squat massive frame, ' + STYLE,
  },
  // P8 identity fix: the card is "Spotter" — a gym spotter projecting a
  // shield, not an orb drone.
  'support-drone': {
    kind: 'unit',
    seed: 48,
    desc:
      'gym spotter with arms raised ready to catch, sturdy training partner projecting a small ' +
      'glowing blue energy shield from a wrist device, ' + STYLE,
  },
  'blade-runner': {
    kind: 'unit',
    seed: 53,
    desc: 'agile blade fighter with a glowing energy sword, light armor, dashing pose, ' + STYLE,
  },
  // --- structures + environment (plain, no team outline) ---
  'forge-core-player': {
    kind: 'plain',
    seed: 61,
    desc:
      'cyberpunk forge reactor monolith, glowing cyan energy core in dark steel fortress housing, ' +
      'pixel art game building sprite, dark outline, centered',
  },
  'forge-core-opponent': {
    kind: 'plain',
    seed: 67,
    desc:
      'cyberpunk forge reactor monolith, glowing red energy core in dark steel fortress housing, ' +
      'pixel art game building sprite, dark outline, centered',
  },
  'forge-core-player-damaged': {
    kind: 'plain',
    seed: 61,
    initFrom: 'forge-core-player',
    desc:
      'heavily damaged cracked cyberpunk reactor monolith, dimmed flickering cyan core, broken ' +
      'steel housing with cracks and sparks, pixel art game building sprite, dark outline, centered',
  },
  'forge-core-opponent-damaged': {
    kind: 'plain',
    seed: 67,
    initFrom: 'forge-core-opponent',
    desc:
      'heavily damaged cracked cyberpunk reactor monolith, dimmed flickering red core, broken ' +
      'steel housing with cracks and sparks, pixel art game building sprite, dark outline, centered',
  },
  'arena-floor': {
    kind: 'plain',
    seed: 71,
    size: { width: 128, height: 320 },
    view: 'high top-down',
    background: true,
    desc:
      'seamless top-down dark cyberpunk gym floor texture, dark navy rubber gym tiles with ' +
      'subtle panel seams, faint teal glow trim lines, worn metal details, pixel art tileable ' +
      'game background, muted, low contrast',
  },
};

function apiKey() {
  if (process.env.PIXELLAB_AI_KEY) return process.env.PIXELLAB_AI_KEY;
  const env = fs.readFileSync(path.join(CLIENT, '.env.local'), 'utf8');
  const m = env.match(/PIXELLAB_AI_KEY\s*=\s*(\S+)/);
  if (!m) throw new Error('PIXELLAB_AI_KEY not found (env or client/.env.local)');
  return m[1];
}

async function call(route, body, key) {
  const res = await fetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const stripB64 = (img) => (img.base64 ?? img).replace(/^data:image\/png;base64,/, '');

/**
 * Champion walk cycles (P4): 4 frames per champion via animate-with-text.
 * The recipe that keeps character identity (found experimentally — plain
 * animate-with-text turns a south-facing walker around): anchor frame 0 to
 * the base sprite via inpainting_images AND raise image_guidance_scale to 3.
 * Raw frames land in assets/arena-pixellab-src/anim/; idempotent per
 * champion (delete its frame files to regenerate).
 */
const ANIM_DIR = path.join(RAW_DIR, 'anim');
const WALK_FRAMES = 4;

async function animate() {
  const key = apiKey();
  fs.mkdirSync(ANIM_DIR, { recursive: true });
  const champions = Object.entries(MANIFEST).filter(([, s]) => s.kind === 'champion');
  for (const [name, spec] of champions) {
    const frame0 = path.join(ANIM_DIR, `${name}-walk-0.png`);
    if (fs.existsSync(frame0)) {
      console.log(`skip ${name} walk (frames exist)`);
      continue;
    }
    const refB64 = fs.readFileSync(path.join(RAW_DIR, `${name}.png`)).toString('base64');
    process.stdout.write(`animate ${name} walk... `);
    const json = await call(
      '/animate-with-text',
      {
        image_size: { width: 64, height: 64 },
        description: spec.desc,
        action: 'walking in place, marching, facing the camera the whole time',
        view: 'low top-down',
        direction: 'south',
        image_guidance_scale: 3.0,
        reference_image: { type: 'base64', base64: refB64 },
        inpainting_images: [{ type: 'base64', base64: refB64 }, null, null, null],
        seed: spec.seed,
      },
      key
    );
    (json.images ?? []).slice(0, WALK_FRAMES).forEach((img, i) => {
      fs.writeFileSync(
        path.join(ANIM_DIR, `${name}-walk-${i}.png`),
        Buffer.from(stripB64(img), 'base64')
      );
    });
    console.log('ok');
  }
}

async function generate() {
  const key = apiKey();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const [name, spec] of Object.entries(MANIFEST)) {
    const rawFile = path.join(RAW_DIR, `${name}.png`);
    if (fs.existsSync(rawFile)) {
      console.log(`skip ${name} (raw exists)`);
      continue;
    }
    const body = {
      description: spec.desc,
      image_size: spec.size ?? { width: 64, height: 64 },
      view: spec.view ?? 'low top-down',
      direction: 'south',
      no_background: !spec.background,
      seed: spec.seed,
    };
    if (spec.initFrom) {
      const init = fs.readFileSync(path.join(RAW_DIR, `${spec.initFrom}.png`));
      body.init_image = { type: 'base64', base64: init.toString('base64') };
      body.init_image_strength = 250;
    }
    process.stdout.write(`generate ${name}... `);
    const json = await call('/generate-image-pixflux', body, key);
    fs.writeFileSync(rawFile, Buffer.from(stripB64(json.image), 'base64'));
    console.log('ok');
  }
}

/** 1px-radius dilated outline in `rgb` composited behind the sprite. */
function outline(png, rgb, thickness = 2) {
  const { width, height } = png;
  const out = new PNG({ width, height });
  png.data.copy(out.data);
  const solidAt = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && png.data[(y * width + x) * 4 + 3] > 40;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (png.data[i + 3] > 40) continue; // sprite pixel wins
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

function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const [name, spec] of Object.entries(MANIFEST)) {
    const rawFile = path.join(RAW_DIR, `${name}.png`);
    if (!fs.existsSync(rawFile)) {
      console.warn(`MISSING raw: ${name} (run generate)`);
      continue;
    }
    const raw = PNG.sync.read(fs.readFileSync(rawFile));
    if (spec.kind === 'plain') {
      fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), PNG.sync.write(raw));
      count++;
      continue;
    }
    for (const team of ['player', 'opponent']) {
      const img = outline(raw, TEAM_RGB[team]);
      fs.writeFileSync(path.join(OUT_DIR, `${name}--${team}.png`), PNG.sync.write(img));
      count++;
    }
    // Champion walk frames (P4): outline each frame per team when present.
    if (spec.kind === 'champion') {
      for (let i = 0; i < WALK_FRAMES; i++) {
        const frameFile = path.join(ANIM_DIR, `${name}-walk-${i}.png`);
        if (!fs.existsSync(frameFile)) continue;
        const frame = PNG.sync.read(fs.readFileSync(frameFile));
        for (const team of ['player', 'opponent']) {
          const img = outline(frame, TEAM_RGB[team]);
          fs.writeFileSync(path.join(OUT_DIR, `${name}--${team}--w${i}.png`), PNG.sync.write(img));
          count++;
        }
      }
    }
  }
  console.log(`built ${count} sprites -> ${OUT_DIR}`);
  console.log('now crush them:  npx pngquant --force --ext .png src/arena-game/features/arena/sprites/px/*.png');
}

const cmd = process.argv[2];
if (cmd === 'generate') await generate();
else if (cmd === 'animate') await animate();
else if (cmd === 'build') build();
else if (cmd === 'all') {
  await generate();
  await animate();
  build();
} else console.log('usage: arena-pixellab-gen.mjs generate | animate | build | all');
