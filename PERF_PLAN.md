# EvoForge Web Performance Plan (2026-07-18)

> Measured, not guessed. Every phase has a number it must move, and the
> Lighthouse gate ratchets after each verified win (raise floors when the
> build clears them comfortably — never lower one to go green).

## Baseline (2026-07-18, current deploy)
- **Lighthouse mobile (median of 3):** perf **53** · a11y 100 · BP 100 · SEO 100
- **Metrics:** FCP **0.8s** (good) · Speed Index 2.8s · **LCP 6.6s** ·
  **TTI 6.6s** · **TBT 1.2s** — the "fast paint, slow interactive" signature
- **Payload:** **3.9 MB JS** = `__common` 1987 KB + `entry` 1078 KB + small
  route chunks (routes are already split: battle 96 KB, progress 68 KB…)
- **Real device (nav-freeze beacon):** each cold start = ~3 × ~1s main-thread
  stalls on `/` (the parse), then essentially stall-free navigation
- **Bundle decomposition (source-map-explorer, real numbers):**
  - common: **react-native-reanimated 733 KB**, exercise-library-imported
    **141 KB**, supabase stack ~220 KB (auth 116 + realtime 36 + phoenix 24 +
    storage 23…), tanstack 60, svg 46, expo-image 31, src/ui ~150
  - entry: expo-router 406 + react-native-web 283 + react-dom 174 —
    the framework floor, effectively irreducible on this pipeline
- **Broken static render:** `app.json` has `web.output: 'static'` but every
  route's pre-rendered `<body>` is EMPTY, and hydration logs React #418.
  The user stares at background until the full 3.9 MB parses — this is WHY
  LCP≈TTI≈6.6s despite FCP 0.8s.

## Phase 1 — Fix static pre-rendering (target: LCP 6.6s → ~1s territory)
The highest-leverage, lowest-code phase. `output:'static'` should emit each
route's first render into the HTML; something in the root layout breaks it
(suspects, in order: an early return / provider that renders nothing during
static render — PersistQueryClientProvider gating children on restore;
`useFonts`; something throwing during the node render pass, swallowed).
1. Reproduce locally: `npx expo export -p web` → inspect `dist/index.html`
   body; instrument the static pass (expo export logs component errors when
   `EXPO_DEBUG=1`).
2. Fix so the SIGN-IN shell (logo, form skeleton) and the app chrome
   pre-render. PersistQueryClientProvider on web may need
   `restoring`-agnostic children or a static-safe fallback UI.
3. This should also kill the React #418 hydration warning (server empty vs
   client content IS the mismatch).
4. Verify: dist body contains real markup; Lighthouse LCP < 2.5s; hydration
   warning gone; WebKit iPhone tour + authed cold start clean.
**Gate after:** raise `categories:performance` floor 0.45 → 0.6, make LCP an
error ≤ 3000ms.

## Phase 2 — Lazy data: the exercise library (−141 KB parse at boot)
`exercise-library-imported.ts` (908 exercises) is statically imported into
the COMMON chunk — every user parses it at boot; only Train/search need it.
1. Move the dataset to a lazily-imported module (`import()` on first use
   behind the existing `EXERCISE_LIBRARY` accessor becoming async, or a
   suspense-free `loadLibrary(): Promise` seam with the tiny base library
   staying sync for cold paths).
2. The parity/library tests keep pinning the dataset — they can import it
   directly (tests may stay sync).
3. Verify: decomposition shows it out of common; search/Train first-use
   still instant on the tour (prefetch it on Train focus).

## Phase 3 — The Reanimated diet (goal: 733 KB out of `common`)
Reanimated is the single biggest module and it sits in COMMON because core
UI (shell, neon-button, toast-host, xp-bar, avatar/hero stages…) imports it
at module scope — while the doctrine has already been REMOVING its work on
web (boot fade → CSS; screen entrance → pinned visible on web; two crash
lessons). Web animation here is mostly simple fades/pulses/springs that CSS
does natively.
1. Inventory every reanimated import reachable from common (≈12 files).
2. Migrate the simple ones (opacity/translate loops, one-shot fades) to the
   CSS-animation pattern already proven in `+html.tsx`/`animations.ts` —
   with `useReducedMotion` respected via media query.
3. Keep reanimated where it earns its weight (battle arena choreography,
   level-up ceremony) but move those imports behind the ALREADY-SPLIT battle
   / lazy chunks so the library loads with them, not at boot.
4. This is incremental — each migrated file is shippable; the win only lands
   when the LAST common-chunk import moves (verify with the decomposition).
**Expected combined effect of 2+3:** common ~1990 → ~1100 KB; TBT and the
real-device boot stalls drop proportionally.

## Phase 4 — Boot-path trims (small, additive)
- `<link rel="preconnect">` to the Supabase origin in `+html.tsx` (auth
  restore is the first request every boot).
- Defer sound/beacon/janitor init to idle (guard already lazy; verify none
  block first paint).
- Audit the idle tab-prefetch stagger so it never lands during the parse
  window (delay until TTI + 2s).
- Supabase realtime (~60 KB) ships unused until live matchmaking — check
  whether supabase-js v2 tree-shakes `realtime` when unreferenced; if not,
  accept (Phase 4 of the multiplayer roadmap will use it).

## Phase 5 — The endgame: native builds (EAS)
The framework floor (entry ≈ 900 KB of expo-router + RNW + react-dom) and
the parse cost exist ONLY on web. EAS native builds eliminate the bundle
parse entirely and unlock the animations/haptics already gated to native.
Not part of this plan's execution — tracked as the horizon item it has
always been (EVOFORGE_TRANSFORM.md).

## Order & verification discipline
1 → 2 → 3 → 4, each phase: build → decomposition diff → Lighthouse (3-run
median) → WebKit iPhone tour → beacon check after deploy → ratchet the gate.
Success for THIS plan: **performance ≥ 75** (from 53), LCP < 2.5s, TBT
< 600ms, real-device boot stalls ≤ 1 × 1s, with a11y/BP/SEO held at 100.
