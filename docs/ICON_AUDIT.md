# EvoForge icon audit (2026-08-11)

The inventory the icon overhaul was built from, and the classification decisions
that shaped it. Read this before replacing anything: several of the entries below
are **preserve** for reasons that are not obvious from looking at the file.

## The headline finding

**EvoForge has almost no icon image files.** 118 raster/vector assets exist and
only six of them are UI icons. The app's icon system is three things:

| System | Where | Count | Verdict |
|---|---|---|---|
| Hand-authored SVG pixel glyphs | `src/ui/core/pixel-icons.tsx` | 35 icons | **PRESERVE** (see below) |
| Raw emoji + Unicode in JSX | 40+ files | 83 distinct glyphs, 577 uses | **MIXED** — the real problem |
| PixelLab raster sprites | `assets/arena-pixellab-src/`, `assets/forge-materials/` | 45 files | **PRESERVE** — already PixelLab |

So "replace every pixel icon that is not PixelLab" would have meant deleting the
only coherent icon system in the app and replacing it with something worse. The
actual inconsistency is the **emoji**, and that is what the overhaul targets.

## 1. `pixel-icons.tsx` — PRESERVE, and here is why

35 icons authored as ASCII grids (`'.##.....##.'`) rendered to SVG `<Rect>`s.
Not PixelLab provenance. Replacement candidates by the letter of the brief —
and replacing them would be a clear downgrade:

- **They are runtime-tintable.** `color` is a prop, and the tab bar's
  active/inactive states, every card tint and every theme colour depend on it.
  A baked 64×64 raster is one colour. The existing `forge-materials-gen.mjs`
  already recorded this cost in its own header: *"a baked PNG is one size and
  one colour"*.
- **They are resolution-independent.** One source is crisp at 10px and at 48px.
  These render at **14–19px**. A 64×64 raster downscaled to 14px is mush —
  which is why `forge-materials-gen.mjs` generates at **32×32, not 64**, with
  the note *"a smaller source keeps the pixels honest"*.
- **They cost no bytes** and no network.
- They are genuinely pixel art, on a grid, with the crisp edges the style asks
  for.

This is the brief's own exclusion: *"functional UI symbols where conversion to
pixel art would reduce clarity"*, and *"if PixelLab cannot produce a clean
result for a highly functional icon, use the simplest clean pixel-art version
possible and document the decision"*. This is that documentation.

**They are, however, incomplete** — which is the actual defect. Nine of them
already exist and the app still uses an emoji in some places for the same
concept. That is fixed by the consistency sweep, not by regeneration.

## 2. Emoji and Unicode — the real inconsistency

577 uses across 40+ files. They split into two very different groups.

### 2a. Typographic furniture — PRESERVE

`→ ✓ › ‹ × ✕ ─ ▸ ▾ ▴ ▲ ▼ ● ◆ ◈ ✦ ★ ☆ ▮ ⚑ …`

Chevrons, rules, ticks, bullets. These are **text**, they inherit `color` and
font weight, they align on the text baseline beside their labels, and they
render identically everywhere because they are in every system font. Converting
a `›` chevron to a raster would misalign it and make it un-tintable. Left alone.

### 2b. Colour emoji — REPLACE

These render through the platform's **colour emoji font**: full-colour, rounded,
Apple/Google/Microsoft-specific, and completely outside the dark-navy/cyan
palette. They are the reason the UI reads as inconsistent.

| Glyph | Sites | Concept | Action |
|---|---|---|---|
| 🔒 | 14 | locked | PixelLab `lock` |
| ⚡ | 11 | energy / hype | **existing `PixelBolt`** |
| 📷 📸 🖼 | 10 | camera / capture | **existing `PixelCamera`** |
| 🏆 | 4 | victory | PixelLab `trophy` |
| 🔥 | 4 | streak | **existing `PixelFlame`** |
| 👥 👤 | 6 | friends / athlete | **existing `PixelPeople`** |
| 👻 | 3 | ghost opponent | PixelLab `ghost` |
| 🥇 🥈 🥉 | 6 | podium | PixelLab `medal` |
| 🎖 👑 | 3 | badge / champion | PixelLab `badge`, `crown` |
| 🏋 | 2 | lifting | **existing `PixelDumbbell`** |
| 🔍 | 2 | search | PixelLab `search` |
| ⚖ | 2 | fairness | PixelLab `scales` |
| 🪙 | 2 | coin | **existing `CoinIcon`** |
| 🔔 | 1 | notification | **existing `PixelBell`** |
| 🛡 | 1 | defence | **existing `PixelShield`** |
| 🎯 | 1 | target | **existing `PixelTarget`** |
| 📋 🕹 ✨ 🏷 💬 🧭 📊 🥤 ➰ | 9 | misc | case by case |

**Nine of the fourteen most-used replacements need no generation at all** — the
pixel icon already exists and the emoji is simply an older call site. That is
the cheapest and largest consistency win available, and it lands first.

**FX particles are excluded.** `ui/battle/move-fx.tsx` uses `✦ ⚡ ➰ 🥤` as
*particle glyphs* in a rising-sparks effect — dozens of instances, animated,
sub-10px, deliberately throwaway. Rasterising those would add draw calls to the
battle loop for no visual gain.

## 3. Raster assets

| Path | Dims | Provenance | Verdict |
|---|---|---|---|
| `assets/arena-pixellab-src/*.png` (33) | 64×64 | **PixelLab** (`arena-pixellab-gen.mjs`) | PRESERVE — this is the style reference |
| `assets/forge-materials/*.png` (6) | 32×32 | **PixelLab** (`forge-materials-gen.mjs`) | PRESERVE |
| `assets/arena-autosprite-src/shredder/*` (6) | 640–1024 | AutoSprite pipeline | PRESERVE — character sprites |
| `assets/muscle-masks/**` (42) | 887×1774 | **Tyson's hand-drawn Krita masks** | **PRESERVE — never redraw.** The masks are the source of truth (`tools/extract_muscle_masks.py`) |
| `assets/muscle-map/*.png` (2) | 887×1774 | Hand-drawn | PRESERVE |
| `assets/images/icon.png`, `favicon`, `splash-icon`, `android-icon-*`, `logo-glow` | various | Brand | PRESERVE — logo recognition |
| `public/icon-192/512`, `apple-touch-icon` | 192–512 | Brand (PWA) | PRESERVE |
| `assets/arena-pixel-src/kenney-1bit-monochrome.png` | 784×352 | **Third-party (Kenney)** | PRESERVE — licensed source art, not ours to regenerate |
| `assets/arena-madmog-src/madmog-streamavatars.png` | 6400×2816 | Third-party | PRESERVE |
| `assets/images/tutorial-web.png` | 1480×855 | Screenshot | PRESERVE — a photograph of the app |
| `assets/images/tabIcons/*.png` (6) | 24–73 | **Expo template scaffold** | **DELETE — unused** |
| `assets/expo.icon/**` | — | Expo scaffold | PRESERVE (build input) |

## 4. Style reference

The primary reference is `assets/arena-pixellab-src/champion-shredder.png` and
its siblings — 64×64, transparent, dark outline, three-tone shading, the cyan
Shredder palette. The prompt style that produced the coherent Forge material set
is in `forge-materials-gen.mjs`:

> `pixel art game item icon, single object centered on empty background, chunky
> readable silhouette, dark outline, three-tone shading, no text, no numbers, no
> letters`

**Canvas size deviates from the brief on purpose.** The brief specifies 64×64.
UI icons here render at **14–28px**, and `forge-materials-gen.mjs` already
learned that a 64px source downscaled to that range loses the pixel grid. New UI
icons are generated at **32×32** so one source pixel maps to roughly one or two
device pixels at the sizes actually used. Larger celebratory art (trophy, crown)
stays at 64×64 because it renders at 40–64px.

## 5. What the overhaul does, in order

1. **Consistency sweep** — every colour emoji that already has a `PixelGlyph`
   equivalent is swapped for it. No new assets.
2. **Generate** the reward/status icons that have no pixel equivalent, via
   `scripts/pixellab/` with a manifest, pinned seeds and recorded provenance.
3. **Central registry** — `src/ui/core/icons.tsx`, one typed lookup over both
   the SVG glyphs and the generated rasters, with size/state/a11y handling and
   pixel-preserving rendering.
4. **Delete** the unused Expo template `tabIcons/`.

## 6. Preserved deliberately — summary

- The whole `pixel-icons.tsx` SVG set (tintable, resolution-independent, better
  at the sizes actually used).
- Typographic Unicode furniture (chevrons, ticks, rules).
- Battle FX particle glyphs.
- Muscle masks and the muscle map (Tyson's own art).
- Brand and PWA icons.
- Third-party licensed sprite sheets.
- Every existing PixelLab asset.
