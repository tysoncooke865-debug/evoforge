# Asset provenance

## PixelLab sprites (`features/arena/sprites/px/`) — the live set

- **Source**: AI-generated via the PixelLab API (https://pixellab.ai) under
  Tyson's API key (`PIXELLAB_AI_KEY` in `client/.env.local`), polish pass
  Phases 2–3 (2026-07-23).
- **Pipeline**: `client/scripts/arena-pixellab-gen.mjs` —
  `generate` calls the API (64×64, low top-down, pinned seeds; idempotent
  per raw file in `client/assets/arena-pixellab-src/`), `build`
  post-processes: characters get a team-colored outline variant per side
  (`--player` cyan / `--opponent` red), cores/floor pass through unchanged.
  Crush with pngquant after building (the repo-wide asset diet applies).
- **Team encoding**: the ART carries card/champion identity (champions carry
  their path colors); the TEAM reads from the baked outline + the renderer's
  base plate, health-bar tint and chevron. One generation serves both sides.
- **Coverage**: 5 official champions, 10 fighter-card units, 2 Forge Cores
  (+ cracked damage variants), 1 lane floor texture (128×320).
- **Consumers**: `features/arena/components/sprites.ts` (registry),
  `lane-strip.tsx` (units + champions + floor), `core-bar.tsx` (cores).

## Marksman mob frames (`features/arena/sprites/px/drone-archer--*`) — the one animated combatant

- **Source**: a user-supplied third-party sprite sheet,
  `client/assets/arena-madmog-src/madmog-streamavatars.png` (6400×2816, a
  25×11 grid of 256px cells; a post-apocalyptic marksman). This is the ONE
  arena combatant NOT generated through PixelLab, so it has its own committed
  slicer rather than a MANIFEST entry.
- **Pipeline**: `client/scripts/arena-madmog-gen.mjs build` — slices the rows
  into the `drone-archer` (Javelin Marksman) unit's animation set, area-
  downsamples each frame to 64×64 with a shared scale + baseline, then applies
  the SAME 2px team-outline (`--player` cyan / `--opponent` red) and pngquant
  crush as the PixelLab pipeline. Row map lives in the script header.
- **Animations** (8 frames each, per team; see `sprites.ts::unitAnimFrames`):
  `toward`/`away` run cycles (the vertical lane faces player units away and
  opponents toward, so team selects direction), `attack` (side-view firing
  loop, ~1.1 s ≈ the fire cadence), `death` (top-down collapse → gib). The
  hit reaction reuses the shipped white-flash + knockback recoil — the sheet
  has no distinct flinch pose.
- **Team + art-bible note**: the character's red palette is its IDENTITY, kept
  for both sides; team still reads from the outline/plate/health-bar/chevron
  exactly like every other combatant. This is a deliberate, documented
  divergence from ART_BIBLE §5 ("coral/red is enemy language") and §2 ("no
  usable directional art") — a user-directed external asset, not a generated
  one, and the vertical-lane geometry makes its directional frames legitimate.
- **Consumers**: `sprites.ts` (registry + `unitAnimFrames`), `lane-strip.tsx`
  (`UnitMarker` run/attack selection + `Floater` death frames), `combat-fx.ts`
  + `arena-screen.tsx` (death floater carries the dead unit's identity).

## Legacy 1-bit sprites (`features/arena/sprites/*.png`) — fallback source

- **Source**: Kenney — *1-Bit Pack* (v1.2), https://kenney.nl/assets/1-bit-pack
- **License**: CC0. Original license text:
  `client/assets/arena-pixel-src/KENNEY-LICENSE.txt`.
- **Pipeline**: `client/scripts/arena-sprite-tools.mjs` (slice/tint/4×
  upscale). No longer referenced by the registry, kept on disk as the
  documented last-resort fallback source (Metro does not bundle unused
  assets). The registry's runtime fallback for a missing key remains the
  colored dot / letter glyph — never a broken image.
