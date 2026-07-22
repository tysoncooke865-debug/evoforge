# Asset provenance

## Pixel sprites (`src/features/arena/sprites/`)

- **Source**: Kenney — *1-Bit Pack* (v1.2), https://kenney.nl/assets/1-bit-pack
- **License**: Creative Commons Zero (CC0) — free for personal, educational
  and commercial use, no attribution required. We credit Kenney anyway.
  Original license text: `assets/pixel-src/KENNEY-LICENSE.txt`.
- **Pipeline**: `scripts/sprite-tools.js` slices 16×16 tiles from
  `assets/pixel-src/kenney-1bit-monochrome.png`, recolors the monochrome
  shapes into the EvoForge palette (team cyan/red, path colors), and
  nearest-neighbour upscales 4× for crisp mobile rendering. Tile picks and
  palette live in that script — re-run `node scripts/sprite-tools.js build`
  after changing either.
- **Consumers**: `src/features/arena/components/sprites.ts` (registry),
  `lane-strip.tsx` (units + champions), `core-bar.tsx` (Forge Cores).
- Sprites live inside `src/features/arena/` so the whole tree copies
  verbatim into EvoForge's `client/src/arena-game/` package.
