# Arena Visual & Gameplay-Feel Audit — polish pass Phase 1 (2026-07-23)

**Baseline:** `b5ed70f` on `expo-rewrite` (post overnight-hardening P1–P14; balance
0.6.0, save v6, 487 arena tests green). This audit is about how the Arena LOOKS
and FEELS, not whether it works — the overnight report already established it
works (`OVERNIGHT_ARENA_BUILD_REPORT.md`).

## How this audit was produced (actual running build, not recall)

- `npx expo export -p web` at baseline, served from `dist/`, driven with
  Playwright at phone size (390×844, DPR 2) signed in as smoke ALPHA.
- **One full battle played to completion** (Training AI, Titan captain, cards
  deployed throughout, DEFEAT by core destruction at 2:07 elapsed) plus a
  second partial match observed for ~12s at DPR 4 for pixel-level inspection.
  Screenshots at t≈1s/6s/18s/38s/70s, end, result overlay, plus every menu
  screen (title, onboarding, lobby, champions, deck-builder, collection, rank,
  gym, battle-log, profile, tutorial).
- Reproduce with `client/scripts/arena-visual-tour.mjs` (committed with this
  audit; needs `npm i playwright` somewhere on the path and the dist served on
  :4173 — see `client/.claude/skills/verify`).
- Code-level findings verified against the working tree (file:line cited).

## Verdict in one paragraph

The Arena plays correctly and reads *adequately*, but presents like an
engineering testbed: two large, entirely featureless dark rectangles occupy
~70% of the screen, populated by 18–24px single-hue recolored Kenney 1-bit
tiles that never animate, never swing, never shoot — units glide silently into
each other and numbers float up. There is **no audio at all**, no battle
intro, no ending ceremony (the DEFEAT card pops the same frame the core dies),
and the EvoForge main-app tab bar stays visible through the whole match. The
information design underneath (health bars, chevrons, momentum edges, energy
pips, cooldown fills) is genuinely good and must be preserved — the missing
layer is identity, weight, and ceremony.

---

## Findings, classified

Severity: ▲ high-impact for the "boring prototype" feel · △ real but secondary.

### A. Visual identity

- **A1 ▲ The battlefield is empty.** Lanes are flat `colors.surface` rounded
  rects with a 1px border on a flat `colors.bg` screen — no floor art, no
  texture, no depth cue, no environment (no gym, no machines, no crowd, no
  light). `lane-strip.tsx:481-497`, `arena-screen.tsx:719`. Screenshot t=1s:
  four sprites on a void.
- **A2 ▲ Sprites are flat-tinted placeholder tiles.** All units/champions are
  16×16 Kenney 1-bit tiles recolored to a single hue (team cyan/red, path
  color for champions) and pre-scaled 4× (`scripts/arena-sprite-tools.mjs`,
  `ASSETS.md`). One tile per card; silhouettes are thin and read as glyphs,
  not characters. Zero EvoForge-specific art anywhere in the battle.
- **A3 ▲ No audio, no haptics.** Grep-verified zero sound/music/vibration
  references in the package. Every hit, death, ultimate and core-fall is
  silent.
- **A4 △ Menu screens are unstyled text lists.** Title = three lines of text +
  one button on a void; lobby = ten identical full-width buttons; champion
  select/detail = text stat sheets with no portrait or sprite anywhere
  (`screens/index.tsx`, `lobby.tsx`, `champions.tsx`). Functional, but nothing
  says "game" until the battle screen.
- **A5 △ The arena duplicates the EvoForge theme rather than sharing it**
  (`constants/theme.ts` vs `src/theme/tokens.js`; bg `#070B12` vs `#070b14`
  etc.), and — unlike the rest of the app — never uses the pixel display font
  (`PIXEL_BOLD` in main-app `segmented-tabs.tsx` etc.). Brand-consistent
  cyan, but a missed identity lever.

### B. Combat feel

- **B1 ▲ Units do not animate.** No idle, no walk cycle, no attack frames, no
  directional facing (a chevron carries direction). Movement is positional
  gliding at 20 ticks/s. Attacks have no anticipation, no follow-through, no
  recoil, no knockback — damage just appears on the target
  (`lane-strip.tsx:378-478`; FX inventory in `combat-fx.ts`).
- **B2 ▲ No projectiles.** Ranged units deal damage with zero visual travel;
  the ranged/healer sprite fallback is a single letter glyph
  (`lane-strip.tsx:447-474`).
- **B3 ▲ No hit-stop, no camera, no slow-motion.** The only "shake" is a
  ±2.5–5px translateX on the 28px core sprite (`core-bar.tsx:44-66`). Heavy
  attacks, ultimates and core destruction all land with the same weight as a
  basic hit, minus a bigger telegraph ring.
- **B4 ▲ Match start/end have no ceremony.** Start: ActivityIndicator →
  battle already running (`arena-screen.tsx:481-487`); no countdown, no
  opponent reveal, no champion entrance. End: the ResultOverlay pops the same
  frame the core reaches 0 (`result-overlay.tsx`) — observed live; the core's
  destruction itself has no destruction moment.
- **B5 △ Existing FX are good but small.** Hit flash (150ms), damage/heal
  floaters, death ✕+ring, spawn poofs, ability/ultimate telegraph rings, core
  shake/flash with a severe tier — all present, frame-driven, capped
  (P6, `combat-fx.ts` + wiring `arena-screen.tsx:128-249`). They read at
  arm's length as "small ticks", not impact. This layer is the right
  architecture to build on (see "What must be preserved").
- **B6 △ Per-champion FX identity does not exist.** All five champions share
  identical ring/flash/floater shapes; the ONLY differentiator is the path
  hue (`combat-fx.ts:184`, `theme.ts:33-86`). Nothing about Titan hits looks
  heavier than Cardio Machine hits.

### C. Readability

- **C1 ▲ Stacked units overprint into an unreadable pile.** In-combat units
  occupy the same few pixels: at DPR-4 zoom, an enemy fighter + both champion
  frames + a summon overlapped into one indecipherable sandwich. There is no
  stacking offset, outline separation or draw-order rule beyond array order
  (`lane-strip.tsx` positions purely by engine x → topPct).
- **C2 ▲ Opposing champions can look near-identical.** Champion sprites are
  path-tinted, team identity is only a thin 2px ring + health-bar tint —
  observed live as "my amber Titan" vs "their amber champion" ~24px apart in
  my own deploy zone (t=38s screenshot). Mirror matches (Titan vs Titan) make
  this worst-case common.
- **C3 △ Card names truncate on a 390pt phone** — "Emergenc…",
  "Javelin Mark…" (4 flex-equal text chips, `card-row.tsx:37-59`). Cost is
  readable; identity of unfamiliar cards is not.
- **C4 △ The deploy zone tint is nearly invisible** (`rgba(34,211,238,0.08)`,
  `lane-strip.tsx:162`) — on the captured frames it needs effort to spot, and
  nothing else marks where deployment is legal until a card is selected.
- **C5 △ Sprite scaling is NOT pixel-safe on web.** Arena `<Image>`s never
  set `image-rendering: pixelated`; the 64×64 pre-scaled PNGs are drawn at
  18/24/28pt (a NON-integer downscale through the browser's bilinear
  filter). The rest of EvoForge sets `imageRendering: 'pixelated'`
  (`src/ui/battle/*`); the arena is the outlier. Visible as mild softening at
  DPR 2; masked at DPR 4.
- **C6 △ No automation/test hooks**: zero `testID` in the whole package —
  this audit had to click by coordinates. Cheap to fix while touching HUD
  components, and it makes every later phase verifiable.

### D. UI presentation

- **D1 ▲ The main-app tab bar (Home/Train/Oracle/Social/Arena/Fuel) stays
  visible during battle**, costing ~70pt of a 844pt phone and inviting an
  accidental mid-match exit. The battle screen is the one place the app
  should go full-bleed. (Route group `(main)` keeps tabs; forge-arena stack
  never hides them.)
- **D2 △ HUD is clean but generic.** Panels are flat surface+border boxes
  with the system font. Information hierarchy is genuinely good (timer, core
  bars, energy pips, ability/ultimate fills, respawn countdown, toasts) — it
  lacks treatment (pixel font, bevels/scanlines/glow restraint, card frames),
  not content.
- **D3 △ Result screen is static text.** VICTORY/DEFEAT banner + reason +
  core compare + rating delta + two buttons (`result-overlay.tsx`). No
  animation, no count-up, no champion moment; defeat and victory differ only
  by word/color.
- **D4 △ Cards are text chips** — no art, no frame, no rarity/category color
  treatment beyond a glyph (`card-row.tsx`). The hand is the player's primary
  interaction surface and looks like form buttons.

### E. Sprite pipeline (facts for the asset phases)

- Pipeline exists and is rerunnable: `client/scripts/arena-sprite-tools.mjs`
  slices/tints/upscales Kenney tiles into
  `features/arena/sprites/*.png` + registry `components/sprites.ts`.
  28 PNGs today (10 cards ×2 teams, 5 champions, 2 cores, +1).
- Consumers are exactly three: `sprites.ts` registry, `lane-strip.tsx`,
  `core-bar.tsx` — a swap of the registry contents upgrades everything.
- Fallback today: missing key → colored dot (melee) or letter glyph
  (ranged/healer). No broken-image path (good), but the fallback looks like
  debug output (C5/A2).
- **A `PIXELLAB_AI_KEY` (36 chars) sits unused in `client/.env.local`** —
  PixelLab (pixellab.ai) generates game-ready pixel-art character sprites
  incl. directional walk/attack animations by API. Nothing in the repo calls
  it yet. This is the obvious lever for Phase 3 real assets (validate the
  key + ToS/rate limits before building around it; keep the Kenney fallback
  hierarchy regardless).
- Sprite budget note: the app went through a deliberate 42% asset diet —
  new sheets should be pngquant-crushed like everything else.

### F. Audio

- Greenfield (A3). No expo-av/expo-audio dependency in the arena today; the
  package would need one added (or Web Audio on web) — treat as its own
  decision in the combat-feel phase, incl. mute-by-default policy inside a
  fitness app.

### G. Performance & stability (baseline to not regress)

- 487 arena tests / 1,558 total green at baseline; deep harness 362 matches,
  0 defects; the tour battle ran without console page-errors.
- FX layer is frame-driven off the existing 50ms store re-render — **zero
  Animated loops, zero extra timers** — with hard caps (floaters 12, pings
  12, telegraphs 4, poofs 8) and TTL cleanup. `verify-motion.mjs` only greps
  `withRepeat`, so any future continuous/ambient effect needs explicit
  reduced-motion wiring the guard will NOT catch (documented doctrine,
  `KNOWN_ISSUES.md` P6/P7).
- Known deferred perf item: corpse accumulation raises late-battle tick cost
  ~2.6% of frame budget (KNOWN_ISSUES). Polish must not multiply per-corpse
  render cost.

### H. Stability-relevant seams (for later phases)

- The visual layer reads ONE seam: the append-only battle log
  (`state.ts:211-219`) + per-frame state snapshots; core damage is
  snapshot-diffed because `damageCore` doesn't log fx (`combat.ts:133-149`).
  New FX kinds (knockback impulse, attack wind-up, projectile spawn) need
  either new log entries (engine change — keep replay-digest identical:
  log entries are digest-inert but verify) or continued snapshot diffing.
- Hit flashes are proximity-matched, not id-matched (engine fx entries carry
  no unit id) — a real per-unit anim system wants ids in the fx log
  (`KNOWN_ISSUES.md` P6).

---

## What already works and MUST be preserved

1. The deterministic engine + replay digests + 487 tests — visual work never
   touches sim math (P6 precedent: FX layer had 0 digest impact).
2. The two-layer FX architecture (pure derivation in `combat-fx.ts` /
   `readability.ts`, timestamped wiring in `arena-screen.tsx`) — extend it,
   don't replace it.
3. The readability primitives: low-health amber, chevrons, momentum edges,
   energy pips, cooldown/charge fills, floater stagger, accessibility labels,
   44pt targets.
4. The information content of the HUD and result screen (incl. the honesty
   copy: "no Forge XP, no Evo Rating change" — a P13 protection artifact).
5. The official five-champion identity (names pinned by content validation)
   and the fallback hierarchy discipline (never a broken-image box).
6. The frame-driven/no-ambient-loop doctrine, unless an effect gets real
   `useReducedMotion` wiring.

## Priority order (what actually kills the "boring 1-bit prototype" feel)

1. **B1/B2 unit life** — animated, characterful sprites (walk/attack/idle) +
   projectiles. Nothing else moves the needle as much.
2. **A1 arena environment** — a real cyberpunk-gym floor with depth and lit
   lanes.
3. **B3/B4 weight + ceremony** — impact tiers (hit-stop, screen shake,
   ultimate slow-mo), battle intro, core-destruction climax, animated result.
4. **D1/D2/D4 chrome** — full-bleed battle, pixel-font HUD treatment, real
   card frames.
5. **B6/C2 champion identity** — per-path FX language + unambiguous
   team-vs-path encoding.
6. **A3 audio** — even a small SFX set (hit/deploy/ult/core/win/lose)
   transforms feel; needs a dependency decision.
