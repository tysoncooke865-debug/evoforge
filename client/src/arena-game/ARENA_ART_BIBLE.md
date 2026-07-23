# EvoForge Arena Art Bible — premium program Phase 6 (2026-07-23)

**Mandatory for ALL AI asset generation.** This formalizes the rules the
shipped pipeline (`client/scripts/arena-pixellab-gen.mjs`) already
practices, plus the variant contract Phase 5 wired in. A generation that
does not follow this document does not merge. Companion docs:
`ARENA_COSMETIC_COMPATIBILITY.md` (what variants must exist),
`AVATAR_VISUAL_SOURCE_MAP.md` (the identity each champion must match),
`ASSETS.md` (provenance).

## 1. Pipeline law (how art is made here — non-negotiable)

- **Generator**: PixelLab `generate-image-pixflux` via the committed script;
  every asset has a **pinned seed** in the MANIFEST and an idempotent raw in
  `assets/arena-pixellab-src/` (re-running never regenerates an existing
  raw). New assets = new MANIFEST entries, never ad-hoc calls.
- **Base style constant** (append to every character prompt):
  `pixel art game sprite, dark cyberpunk gym world, strong readable
  silhouette, dark outline, detailed shading, centered full body`.
- **Team is post-process, not prompt**: characters generate ONCE, neutral;
  the build step composites a 2px dilated outline — player `#22D3EE` /
  opponent `#F87171` — emitting `--player`/`--opponent` files. Art carries
  card/champion identity; the outline (+ base plate, health bar, chevron)
  carries team. **Never bake team colors into generated art.**
- **Walk cycles**: `animate-with-text` ONLY with a frame-0
  `inpainting_images` anchor + `image_guidance_scale: 3.0` (naive calls turn
  the character around — the hard-won P4 lesson). 4 frames, frame 0 = the
  base sprite. `/rotate` south→north returns front views — unusable; the
  chevron carries facing.
- **Compression**: everything through pngquant before commit.

## 2. Perspective & camera

- Characters: **`view: 'low top-down'`** — the reference perspective for
  every combatant, portrait sprite, and variant. The battlefield camera
  faces each unit toward the enemy core; direction is carried by the
  chevron + movement, NOT by directional art (no usable back views exist —
  see pipeline law). If directional art ever becomes possible: south =
  toward camera, north = away, west/east = profiles; east may mirror west
  only where asymmetry doesn't matter (blade/javelin arms matter).
- Environment: floor uses `view: 'high top-down'` (the shipped
  `arena-floor`, 128×320, tiled).

## 3. Source sizes (what the pipeline actually uses)

| Asset | Canvas | Notes |
|---|---|---|
| Unit | 64×64 | rendered ~26pt; silhouette must read at that size |
| Champion (incl. every stage/skin variant) | 64×64 | rendered ~34pt; borrowed ~30pt |
| Walk frame | 64×64 | 4 frames, frame 0 = base sprite |
| Forge Core | 64×64 (+ damaged variant, `initFrom` the intact core, same seed) | |
| Arena floor | 128×320 | tileable vertically; avoid loud accent stripes (finding R3) |
| Portraits/menus | reuse the app's own champion stills (`ui/character/` art) — battle sprites are NEVER enlarged as portrait/card art | |

## 4. Pixel rules

- Nearest-neighbour only: every battlefield `Image` carries
  `imageRendering: 'pixelated'` on web (audit C5) — never remove it; no
  bilinear scaling, no fractional scale factors where avoidable.
- Consistent 1px dark self-outline inside the art (the STYLE constant
  enforces it); the team outline is the build step's job.
- Centered full body, feet on a consistent baseline (the base plate ellipse
  sits under the sprite; anchors must not jump between variants or frames).
- Light reads from the upper left; ground shadow comes from the base plate,
  not baked into the art.
- **No text inside generated art. Ever.**
- No accidental redesign between variants: a stage/skin variant of a
  champion is the SAME character (see §6) — silhouette evolves, identity
  never resets.

## 5. Visual language

Navy-black world (`bg #070B12`, surfaces `#0D1420/#131C2C`); cyan `#22D3EE`
+ electric blue `#3B82F6` are the brand highlights; purple is selective;
coral/red `#F87171` is ENEMY language (never decorate player-side art with
it). Path identity colors (theme.ts, baked into champion art): aesthetic
emerald+gold `#34D399`, titan amber `#F59E0B`, mass fuchsia `#E879F9`,
shredder violet `#A78BFA`, cardio indigo `#818CF8` (deliberately NOT the
team cyan — the P7 readability fix; never regress it). Restrained glow;
silhouette first, effects second.

## 6. Champion continuity (identity per path — the five official champions ONLY)

The player-facing roster is Aesthetics, Titan, Mass Monster, The Shredder,
Cardio Machine. Never generate player-facing Hybrid/Speedster/generic
substitutes. Each champion's arena art must stay recognizable against the
app's own per-stage art (`assets/sprites/<line>/still-stageN.png` — THE
identity reference for stage variants) and against its shipped base sprite
(pinned seeds below; variants use `initFrom` the base sprite so identity
carries).

- **Aesthetics** (seed 11): sleek flawless-proportioned bodybuilder, emerald
  green + gold-trimmed bodysuit, elegant controlled stance. Premium and
  precise — never a mage, never a hybrid.
- **Titan** (seed 7): hulking powerlifter, amber + dark-steel armor with
  glowing seams, wide heavy grounded stance. The app's line is the
  cyber-Viking — keep the mass, beard/hair silhouette where stage art shows
  it. Never a generic robot.
- **Mass Monster** (seed 13): colossal wide-bodied strongman, extreme
  shoulder width, fuchsia + dark armor plates, towering pressure. Bulk
  READS broader than Titan at 34pt — the two must never be interchangeable
  (width vs height is the differentiator, not color alone).
- **The Shredder** (seed 17): lean razor-defined fighter, violet + crimson
  blade-edged suit, aggressive forward lean. The app's arc is
  hoodie-to-defined-ninja — early stages keep the hooded silhouette, final
  stage is shredded and unhooded. Never a monster, never a generic assassin.
- **Cardio Machine** (seed 19): human sprinter physique, indigo + electric
  blue speed suit with momentum lines, ready-to-run stance. The approved
  avatar is HUMAN with cyber speed details — never a full robot.

**Colour is never the only differentiator** — silhouette (width, stance,
lean, gear) must distinguish every pair even in grayscale.

## 7. Variant contract (what Phase 5 wired; what Phase 8+ generates)

Registry naming (sprites.ts — the fidelity chain probes these):

```
<artKey>--s<stage>[--k-<skinId>]--<team>          still
<artKey>--s<stage>[--k-<skinId>]--<team>--w0..w3  walk frames (all 4 or none)
```

- Stage variants `--s2..--s4` (canonical art serves as stage 1): generate
  `initFrom` the champion's base raw, same seed, prompt describing the
  stage's identity per the app ladder (e.g. shredder s1 hooded → s4
  shredded). Each variant ships its own 4 walk frames OR renders static —
  never mix a variant still with canonical frames (layer-drift rule,
  enforced in battle-assets-core.ts and tested).
- Skin variants `--k-<skinId>`: generation-time RECOLOURS of the same
  sprite (palette swap in the build step, mirroring the app's
  `avatar-skins.ts` approach) — not re-generations; identity is pixel-
  identical except palette.
- Cosmetic attachment points: this app has no per-slot gear cosmetics; the
  attachment surfaces are **palette** (skins), **base-plate aura tint**
  (reserved ruling — an equipped aura MAY tint the plate ellipse; decide at
  Phase 8 with screenshots, default OFF), and **portrait** (the app's own
  art, already cosmetic-aware).
- Female variants: blocked app-wide outside the aesthetic line — the arena
  never invents art the app lacks; profile.sex is plumbed for when it exists.

## 8. Review gate for any new asset

At real phone scale (~26-34pt): identity readable? Team side instant?
Distinct from every other roster silhouette in grayscale? Anchor/baseline
consistent with the base sprite? DPR-4 zoom crisp (no soft pixels)? If any
answer is no, re-roll the seed or fix the prompt — never ship "close
enough" and never hand-edit pixels outside the pipeline.
