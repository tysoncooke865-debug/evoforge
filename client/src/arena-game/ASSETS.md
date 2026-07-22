# Asset provenance

## Pixel sprites (`features/arena/sprites/`)

- **Source**: Kenney — *1-Bit Pack* (v1.2), https://kenney.nl/assets/1-bit-pack
- **License**: Creative Commons Zero (CC0) — free for personal, educational
  and commercial use, no attribution required. We credit Kenney anyway.
  Original license text: `client/assets/arena-pixel-src/KENNEY-LICENSE.txt`.
- **Pipeline** (copied into this repo from the standalone evoforge-arena
  repo, 2026-07-23): `client/scripts/arena-sprite-tools.mjs` slices 16×16
  tiles from `client/assets/arena-pixel-src/kenney-1bit-monochrome.png`,
  recolors the monochrome shapes into the EvoForge palette (team cyan/red,
  the five Avatar Path colors), and nearest-neighbour upscales 4× for crisp
  mobile rendering. Tile picks and palette live in that script — re-run
  `node client/scripts/arena-sprite-tools.mjs build` (from `client/`) after
  changing either; use the `preview` command to choose tiles visually.
- **Champion variants** are the five official path slugs
  (`champion-aesthetic--aesthetic.png` … `champion-mass--mass.png`); the
  Mass Monster's tile (col 29, row 2) was picked in the 2026-07-23 survey —
  the broadest silhouette in the character block, deliberately bulkier than
  the Titan's (col 27, row 2).
- **Consumers**: `features/arena/components/sprites.ts` (registry),
  `lane-strip.tsx` (units + champions), `core-bar.tsx` (Forge Cores).
