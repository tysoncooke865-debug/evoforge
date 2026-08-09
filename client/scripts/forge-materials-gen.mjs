/**
 * The six Forge materials as real pixel art, via PixelLab.
 *
 *   node scripts/forge-materials-gen.mjs            # generate any that are missing
 *   node scripts/forge-materials-gen.mjs --force    # regenerate everything
 *
 * Needs PIXELLAB_AI_KEY (env or client/.env.local). Idempotent per file: delete a
 * PNG to regenerate just that one. Seeds are pinned so a regeneration reproduces.
 *
 * WHY GENERATED RATHER THAN DRAWN. The hand-drawn SVG version read as a stepped
 * pyramid rather than a cast bar — a shape you can only really judge by looking at
 * it, and four attempts did not fix it. Real pixel art has the shading and the
 * silhouette weight that a row-per-inset trapezoid cannot.
 *
 * WHAT THIS COSTS, STATED PLAINLY: a baked PNG is one size and one colour. The
 * owner-identification rim the shared pool needs (§"Ownership visibility") can no
 * longer be drawn INTO the sprite, so it is composited around it by the component.
 * That is the trade the drawn version did not have to make.
 *
 * Provenance: AI-generated via pixellab.ai under Tyson's API key, same pipeline and
 * the same terms as the arena champions (see src/arena-game/ASSETS.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..');
const OUT = path.join(CLIENT, 'assets', 'forge-materials');
const API = 'https://api.pixellab.ai/v1';

/**
 * One prompt per denomination. `STYLE` is shared so the six read as a set — the
 * whole point is a ladder, and six sprites drawn in six styles is not one.
 *
 * "single object, centered, no text, no numbers" matters: the numeral is stamped by
 * the component at render time so it scales with the size and stays legible, and a
 * baked-in number would fight it.
 */
const STYLE =
  'pixel art game item icon, single object centered on empty background, '
  + 'chunky readable silhouette, dark outline, three-tone shading, '
  + 'no text, no numbers, no letters';

const MATERIALS = {
  'copper-5': {
    seed: 11,
    desc: 'a single copper metal ingot bar, warm reddish-brown copper, trapezoid cast bar '
      + 'seen from three-quarters above with a flat top face, ' + STYLE,
  },
  'bronze-10': {
    seed: 23,
    desc: 'a single bronze metal ingot bar, golden-brown bronze, trapezoid cast bar '
      + 'seen from three-quarters above with a flat top face, ' + STYLE,
  },
  'iron-15': {
    seed: 37,
    desc: 'a single dark iron metal ingot bar, cold grey iron with rough forged texture, '
      + 'trapezoid cast bar seen from three-quarters above with a flat top face, ' + STYLE,
  },
  'steel-25': {
    seed: 41,
    desc: 'a single polished steel metal ingot bar, bright silver-grey steel with a clean '
      + 'sheen, trapezoid cast bar seen from three-quarters above with a flat top face, ' + STYLE,
  },
  // THE GEMS TOOK A SECOND PASS. The first prompts asked for a "brilliant cut with
  // faceted crown and pointed pavilion" and got a muddy dark sapphire and a ruby
  // that read as a pink shell — the model rendered a rounded cabochon rather than a
  // cut stone. Naming the SILHOUETTE plainly (diamond-shaped, flat top, tapering to
  // a point) works better than naming the jewellery terms, and asking for bright
  // saturated colour stops the stone going black at 30px.
  'sapphire-50': {
    seed: 91,
    desc: 'a single bright blue diamond-shaped gemstone, vivid saturated azure blue, '
      + 'flat faceted top surface, sharp angular facets, tapering to a point at the '
      + 'bottom, white sparkle highlight, jewel icon, ' + STYLE,
  },
  'ruby-100': {
    seed: 97,
    desc: 'a single bright red diamond-shaped gemstone, vivid saturated scarlet red, '
      + 'flat faceted top surface, sharp angular facets, tapering to a point at the '
      + 'bottom, white sparkle highlight, jewel icon, ' + STYLE,
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
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const stripB64 = (img) => (img.base64 ?? img).replace(/^data:image\/png;base64,/, '');

const force = process.argv.includes('--force');
const key = apiKey();
fs.mkdirSync(OUT, { recursive: true });

for (const [name, spec] of Object.entries(MATERIALS)) {
  const file = path.join(OUT, `${name}.png`);
  if (fs.existsSync(file) && !force) {
    console.log(`skip   ${name} (exists)`);
    continue;
  }
  process.stdout.write(`gen    ${name} ... `);
  const json = await call('/generate-image-pixflux', {
    description: spec.desc,
    // 32px, not the arena's 64: these render at 28-72px and a smaller source keeps
    // the pixels honest rather than letting a 64px sprite be downscaled to mush.
    image_size: { width: 32, height: 32 },
    view: 'low top-down',
    direction: 'south',
    no_background: true,
    seed: spec.seed,
  }, key);
  fs.writeFileSync(file, Buffer.from(stripB64(json.image), 'base64'));
  console.log(`ok  ->  assets/forge-materials/${name}.png`);
}
console.log('\ndone.');
