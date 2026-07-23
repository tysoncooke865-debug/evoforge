# Arena Renderer Decision — premium program Phase 4 (2026-07-23)

**Reviewer stance:** independent technical review (Opus 4.8, xhigh). The
brief was explicit — *do not trust previous conclusions automatically*, and
recommend a contained engine migration *only if* a correct Skia renderer
cannot meet targets AND profiling shows fundamental limits AND multiple
optimisation attempts have failed AND the arena can be isolated. This review
re-derived the render model from source, re-read the raw stress data
(`ARENA_STRESS_RESULTS_2026-07-23.json`), and verified the dependency/
delivery context directly. It does not take the Phase 3 report's word.

---

## 1. Decision

**Stay on React Native views. Do NOT migrate the battlefield to Skia now.**
Pursue a staged, measured optimization of the existing renderer. The single
blocking next step is a **real-device measurement** — every number to date is
desktop Chromium, and the mobile risk is currently a synthetic proxy, not an
observation. A 2.9MB-class CanvasKit-WASM rewrite cannot be justified against
a proxy when zero optimization has been attempted and no real phone has been
measured.

This satisfies the acceptance bar: the recommendation is measurement-backed
(§3), no speculative rewrite is approved (§5), the EvoForge integration risk
is addressed (§7), and Phase 5+ inherit a concrete, ordered technical plan
(§6).

## 2. What I re-verified independently (not inherited)

- **The render model** (arena-screen.tsx:700-859, lane-strip.tsx:680-749):
  one Zustand `version` bump per 50ms tick re-renders the *entire*
  `ArenaScreen` subtree. It passes **freshly-allocated arrays/objects** to
  every child each tick (`lane0Units` is a new `.filter()`, `shake`/`pose`/
  transform arrays are new objects), so children reconcile every frame
  regardless of `React.memo`. The engine mutates unit objects **in place**,
  so a marker's `unit` prop keeps the *same reference* across ticks — a memo
  comparator would have to diff scalar fields, not references.
- **The rendering is 20Hz, not 60fps.** React re-renders only on the version
  bump (20/s). Between ticks the DOM is static and the browser idles at 60fps.
  The rAF sampler's `avgFrameMs` therefore **floors at 16.67ms on a 60Hz
  display** and can only reveal *dropped* frames — it cannot show headroom.
  The honest utilization metric is CDP `scriptPct`; the honest drop metric is
  `framesOver16_7`/`framesOver33`. (The Phase 3 tables used CDP correctly, but
  its "60fps through 30/team" headline means "no dropped frames", not "ample
  headroom".)
- **Dependencies/delivery** (package.json, app.json): **no** Skia/CanvasKit
  present; **Reanimated 4.5.0 + react-native-worklets 0.10.0 + gesture-handler
  2.32 already installed**; web `output: "static"` — the product ships as a
  static web PWA (expo-rewrite.evoforge.pages.dev), and there is no native app
  build yet.

## 3. Evidence (re-read from the raw sweep)

Desktop Chromium, production web export, 390×844:

| Condition | alive | script %core | layout+style % | frames >16.7 / >33 (of 512) | effTickHz |
|---|---|---|---|---|---|
| 10/team | 22 | 12.9 | 1.6 | 268 / 0 | 20.0 |
| 20/team | 40 | 12.6 | 1.3 | 139 / 0 | 20.0 |
| 30/team | 60 | 19.5 | 1.8 | 82 / 0 | 20.0 |
| 40/team | 80 | 33.7 | 3.0 | 89 / **9** | 20.0 |
| 30/team +150 particles | 60 | 41.2 | 4.2 | 195 / 1 | 20.0 |
| **4× CPU throttle** 30/team +150p | 60 | 77.9 | 7.6 | 134 / **134** | 19.9 |
| **6× CPU throttle** same | 59 | 76.1 | 8.1 | 92 / **92** | 19.7 (42 stalls) |

- **Sim is never the bottleneck**: ≤1.1ms/frame even at 6× throttle;
  `effectiveTickHz` holds ~20 everywhere until 6× throttle finally starts
  stalling the loop (catch-up clamps). Overload renders choppy; it does not
  play slow.
- **Browser layout/paint is never the bottleneck**: layout+style <5% of a
  core in every unthrottled case, ≤8% throttled.
- **The cost is JS script, and it decomposes cleanly** from the density
  sweep: a **fixed ~12-13% chrome/HUD/scenery floor** (10-unit and 20-unit
  rows are equal at ~12.6-12.9% despite doubling units), plus **~0.5-0.7% of
  one core per active unit above ~40 units** (60→80 units adds ~14% script).
  So 30/team ≈ 12% floor + ~7% units ≈ 19% ✓; 40/team ≈ 12% + ~22% ≈ 34% ✓.
- **Memory** flat at 29.8MB across 10 consecutive fresh matches; profiler
  global + store hook removed on teardown.
- **Input latency corollary**: taps deploy on the next tick through the same
  single JS thread. At 4-6× throttle, frames are 112-267ms, so under mobile-
  class load input would feel that laggy — same root cause, not a separate
  problem.

## 4. Corrected bottleneck characterization

The Phase 3 report named the cost "the un-memoized whole-tree re-render" and
listed *memoize UnitMarker* as the top lever. Independent inspection refines
this in a way that changes the plan:

- The per-tick cost is **two distinct terms**: (a) the **fixed chrome**
  (timer, cores, synergy chips, champion HUD, card row, static scenery)
  reconciling every tick even when unchanged — this **is** memoizable; and
  (b) **N simultaneously-mutating units**, each recomputing position/health/
  bob/attack-pose/recoil/drop-scale from fields that change **every tick during
  combat** and allocating fresh style+transform arrays — this is **NOT**
  memoizable during active dense combat (almost nothing is idle).
- Therefore: memoizing the *chrome* reclaims up to the ~12% fixed floor;
  memoizing *units* buys little in the stress case. Cutting the dominant
  unit-scaling term requires **cheaper-per-unit rendering** (fewer nodes,
  precomputed styles) and/or **moving unit motion off the React
  reconciliation path** (Reanimated worklets, or ultimately Skia).
- Naive `React.memo` is additionally defeated by prop-identity churn from
  `ArenaScreen`; any memoization step must stabilize props / use narrow store
  selectors, not just wrap components.

## 5. Why not Skia now — the migration gate, condition by condition

| Gate condition (all required) | Assessment |
|---|---|
| A correct Skia renderer cannot meet targets | **Unknown / untested.** Cannot be asserted. |
| Profiling shows fundamental limitations | Profiling shows a *script-bound RN path*, not that RN *fundamentally* cannot meet the target. Cheaper-per-unit rendering and off-thread transforms are entirely unexhausted. |
| **Multiple optimisation attempts have failed** | **Zero attempts exist.** Phase 2 deliberately deferred them. This gate fails outright. |
| Arena can be isolated | True (it is a self-contained package) — but isolation permits a future migration, it does not justify one. |

Additional cost specific to *this* app, which the gate does not even list but
which is decisive here:

- **Delivery**: web `output: "static"` → react-native-skia on web is
  CanvasKit **WASM (~1.5MB+ gzipped, larger uncompressed) on the PWA's
  critical-path payload**. Tyson runs the installed iPhone PWA; there is no
  native build to amortize it against.
- **Re-verification surface**: a canvas battlefield must re-establish the
  determinism/replay contract, the digest-inert FX doctrine, the reduced-
  motion gate, and would obsolete the `verify-motion`/`verify-arena-purity`
  guards' current assumptions — the exact stable systems the program is told
  to preserve.
- **Opportunity**: the desktop build and the slice's own stated target
  (30 active combatants) already **pass**; the only failing signal is a
  *synthetic* 4× CPU throttle, with **no real-device data at all**.

Recommending Skia now would be the "speculative rewrite" the acceptance
criteria forbid.

## 6. Recommended path + ordered next steps (each gated by measurement)

Every step stays inside `features/arena/` + `screens/`, changes **no** engine/
balance/determinism code, and is kept only if it measurably helps AND passes
the full gate sweep (tsc · vitest · verify-tokens/motion/battle-engine/
arena-purity · deep harness digest parity · export). Re-measure with the
stress lab (density 30 + the 4× throttle row) **and** a real device at each
step.

- **Step 0 — BLOCKING: real-device baseline (Tyson's device pass).** Open the
  Render Stress Lab (debug → Render Stress Lab) on a recent iPhone, an older
  supported iPhone, and an ordinary Android, PWA + Expo Go, at 30/team; read
  the HUD (fps, >16.7/>33 counts, effTickHz). This converts the mobile risk
  from a proxy into a fact. **No optimization or renderer change should be
  chosen before this reading** — it decides whether Steps 1-2 suffice or Step 3
  is needed, and it may show the current renderer is already fine on target
  hardware (iPhone-class single-core ≈ desktop).
- **Step 1 — memoize the chrome (reclaims the ~12% fixed floor).** Give
  `CoreBar`, `SynergyChips`, `ChampionHud`, `CardRow` and the static lane
  scenery narrow store selectors / stabilized props so they reconcile only on
  real change (energy int, hand ids, seconds, core health, synergy set),
  not on the version tick. Low risk, high certainty, no new dep.
- **Step 2 — cheaper per unit.** Reduce `UnitMarker` node count and replace
  per-render style/transform allocation with precomputed `StyleSheet` refs +
  reused transform arrays. Linear win on the dominant term.
- **Step 3 — off-thread motion (only if a real device fails Steps 1-2).**
  Drive unit position/pose via **Reanimated shared values (worklets — already
  installed, no new dependency)** so unit motion updates on the UI thread
  without a React reconciliation per frame. This also unlocks true 60fps
  *interpolated* motion if desired (see §8). Larger rework; verify it does not
  reintroduce ambient-loop / reduced-motion regressions.
- **Step 4 — contained Skia battlefield (only if Steps 1-3 fail on a real
  device — i.e. the gate's "multiple optimisation attempts have failed" is
  genuinely met).** Requires a written migration spec: canvas battlefield +
  sprite atlas, FX re-implementation, determinism/digest re-verification, and
  an explicit decision to accept the CanvasKit-WASM PWA payload. Reserved, not
  approved.

## 7. Integration risk (addressed)

All recommended work is arena-package-local. The engine, balance tables,
determinism/replay contract, the wider EvoForge app, and the Supabase/
provider boundary are untouched at every step. The `dev-stress` mode already
isolates measurement from real data (zero server writes, no records, no
rating). No step in 0-3 adds a dependency or alters the delivery bundle
shape; only Step 4 would, which is why it is gated behind demonstrated
failure on real hardware.

## 8. Note on the 60fps target vs 20Hz motion

The prompt targets "60 FPS / avg ≤16.7ms". The current renderer meets that as
*no dropped frames*, but the actual **unit motion updates at 20Hz** (each sim
tick); the 60fps is the browser idling on a static DOM between ticks. True
60fps *motion* would require interpolating positions between ticks, which in
the RN-view model would triple reconciliation frequency and worsen the script
bottleneck — so it must NOT be added speculatively. If smoother motion becomes
a goal, Step 3 (Reanimated transforms) is the correct mechanism, because it
interpolates on the UI thread without extra React renders. For a pixel-art
top-down auto-battler, 20Hz motion is a legitimate aesthetic; smoothness is a
want, not a defect, and should be decided from the real-device reading.

## 9. Estimated costs (relative)

| Option | Effort | Risk | New dep / payload | Reversible |
|---|---|---|---|---|
| Step 1 (chrome memo) | S | Low | none | yes |
| Step 2 (cheaper unit) | S-M | Low | none | yes |
| Step 3 (Reanimated motion) | M-L | Medium (doctrine re-verify) | none (already installed) | mostly |
| Step 4 (Skia battlefield) | L | High (rewrite + re-verify determinism/FX) | CanvasKit WASM on PWA critical path | no (structural) |

## 10. Phase 4 acceptance

- Recommendation supported by measurements (§3) and by direct source
  verification of the render model (§2, §4).
- No speculative rewrite approved — Skia is gated behind demonstrated
  optimization failure on real hardware (§5, §6 Step 4).
- EvoForge integration risk addressed (§7).
- Next phase has a clear, ordered, measurement-gated technical foundation
  (§6), starting with the blocking real-device baseline.

## 11. Recommended next model boundary

Per the program schedule, Session 3 (Phases 5-7 — avatar source of truth, art
bible, cosmetic rendering) runs on **Fable 5 at Ultracode/xhigh**. The
renderer-optimization Steps 1-3 above are not their own phase in the schedule;
they fold into the phases that touch rendering (notably Phase 7 cosmetic
rendering, whose acceptance already requires "stress benchmark still meets
target", and Phase 16 graphics tiers). **Step 0 (the real-device baseline)
should be run by Tyson before Phase 7 commits to any renderer change.**
