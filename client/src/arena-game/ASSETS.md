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

## Legacy 1-bit sprites (`features/arena/sprites/*.png`) — fallback source

- **Source**: Kenney — *1-Bit Pack* (v1.2), https://kenney.nl/assets/1-bit-pack
- **License**: CC0. Original license text:
  `client/assets/arena-pixel-src/KENNEY-LICENSE.txt`.
- **Pipeline**: `client/scripts/arena-sprite-tools.mjs` (slice/tint/4×
  upscale). No longer referenced by the registry, kept on disk as the
  documented last-resort fallback source (Metro does not bundle unused
  assets). The registry's runtime fallback for a missing key remains the
  colored dot / letter glyph — never a broken image.
