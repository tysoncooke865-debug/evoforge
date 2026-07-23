# Arena Stress Test Report — premium program Phase 3 (2026-07-23)

The evidence package for the Phase 4 renderer decision. Produced by the new
Render Stress Lab; every number is reproducible (commands in
`ARENA_PERFORMANCE_BASELINE.md`; raw JSON archived from
`scripts/arena-stress-measure.mjs`).

## 1. The instrument (what was built)

- **Mode `'dev-stress'`** (battle-store): a real battle that is never
  recorded to the provider, never persisted as a BattleRecord (driver spawns
  bypass the command log, so a stored record could never replay to its
  digest), and moves 0 Arena Rating. The only production diff of the phase
  (~20 lines + a null-checked `devFrameHook`).
- **Stress driver** (`features/arena/dev/stress-driver.ts`): holds 10-40
  combatants/team via direct `spawnUnitsForCard` top-up (250ms cadence,
  burst-capped, mode-guarded so it can never inject into a real battle);
  melee/ranged mix; 2×/4× sim speed; champion auto-cast; auto-restart loops.
- **Frame profiler** (`features/arena/dev/frame-profiler.ts`): allocation-free
  rAF ring buffer (fps avg / 1% low / worst / >16.7ms / >33ms), store-frame
  hook (sim ms, publish ms, inter-fire stall gaps, effectiveTickHz), Chrome
  heap, React `<Profiler>` commits (dev builds). Exposed on-screen and as
  `window.__ARENA_PROFILE` for automation; removed on unmount (verified).
- **Screen** `/forge-arena/dev-stress` (debug screen → Render Stress Lab):
  mounts the REAL `ArenaScreen` — the measured path IS the production path.
  Fully test-ID'd. Synthetic particle overlay (0/50/150/400 aged Views) in
  its own component so its cost is isolable.
- **Headless bench** (`__tests__/stress-bench.test.ts`, `ARENA_STRESS_BENCH=1`)
  and **browser sweep** (`scripts/arena-stress-measure.mjs`: density sweep,
  particle sweep, CDP script/layout split, 4×/6× CPU throttle, 10-match heap
  trend, teardown check).

## 2. Results (production web export, desktop Chromium, 390×844)

Sim + derivations, headless (per 50ms tick): sim 31-65µs avg, FX derivation
6-15µs, stack offsets 14-22µs — **≤0.2% of the tick budget at 40/team**.

| Condition | fps | 1% low | worst | >33ms | script %core | layout+style % | tickHz |
|---|---|---|---|---|---|---|---|
| 10/team (~21 alive) | 60.0 | 59.5 | 17ms | 0 | 13 | 1.3 | 20.0 |
| 20/team (~40) | 60.0 | 59.5 | 17ms | 0 | 13 | 1.3 | 20.0 |
| 30/team (~60) | 60.0 | 59.5 | 17ms | 0 | 20 | 1.8 | 20.0 |
| 40/team (~80) | 59.0 | 30.0 | 33ms | 9 | 34 | 3.0 | 20.0 |
| 30/team + 150 particles | 59.9 | 49.7 | 33ms | 1 | 41 | 4.2 | 20.0 |
| 30/team + 400 particles | 60.0 | 59.5 | 17ms | 0 | 37 | 4.6 | 20.0 |
| **4× CPU throttle** +150p @30 | **9.0** | 6.0 | 167ms | all | 78 | 7.6 | 19.9 |
| **6× CPU throttle** +150p @30 | **6.2** | 3.7 | 267ms | all | sat. | 8.1 | 19.7 |

Every window validated live (`status running`, fresh battle per step —
the first sweep briefly measured a finished battle's frozen screen; the
harness now warns when a window executed no ticks).

**Memory**: heap flat at 29.8MB across 10 consecutive fresh matches
(restart verified per match via tick counter; gc forced). No trend.
**Cleanup**: leaving the lab removes `__ARENA_PROFILE` + the store hook;
screen unmount stops driver and profiler; ArenaScreen unmount resets the
store (existing behavior).

## 3. Bottleneck analysis (the finding)

1. **The simulation is never the problem.** ≤1.1ms/frame even at 6×
   throttle; `effectiveTickHz` holds ~20 everywhere — overload shows as
   choppy rendering, never as slowed gameplay (catch-up design working).
2. **Browser layout/paint is never the problem.** Layout+style <5% of a
   core in all conditions, DOM ~4-16k nodes.
3. **Script is the entire cost**: re-executing the un-memoized battle tree
   (2 lane strips, every marker, the full HUD) 20×/s, allocating fresh
   style objects per node per frame. Scales with density (13%→34%) and
   saturates a throttled core (9.0fps at 4×, 6.2 at 6×).
4. **Particles are secondary** (+~18% script at 400) — the synthetic overlay
   confirms marginal aged-View cost is affordable; it is the tree
   re-execution, not the node count per se.
5. Desktop meets every prompt target through 30/team; 40/team shows the
   first desktop strain (1% low 30fps). The 4×/6× rows are the phone-class
   proxy: **the current renderer does not meet the 60fps/30-combatant gate
   on mid-tier mobile silicon.** (iPhone-class single-core ≈ desktop, which
   is why the PWA feels fine on Tyson's phone; mid Android is the risk.)

## 4. Capacity statements (prompt targets, measured honestly)

- 30 active combatants: PASS desktop · FAIL 4×-throttle proxy · device pass
  pending hardware.
- 40-50 projectiles: the FX architecture caps live projectile streaks at 10
  by design (plus every ranged unit's fire) — the cap, not performance, is
  the binding constraint; raising it is a Phase 10 choice with lab evidence.
- 100-200 particles: PASS desktop at 400 synthetic; there is no production
  particle system yet (telegraph fragments only) — the overlay bounds the
  cost of adding one.
- Repeated matches: 10 auto-restarted stress matches, flat heap, no stalls.

## 5. What Phase 4 (Opus 4.8 xhigh, independent) should weigh

The ranked, evidence-gated options are in `ARENA_RENDER_ARCHITECTURE.md` §5:
targeted memoization + HUD subscription-split + static-scenery extraction
+ style pooling (attack script cost directly, no new deps, doctrine intact)
versus a Skia canvas battlefield (structural fix; new native dep +
CanvasKit WASM on the PWA path; battlefield rewrite + FX-doctrine
re-verification). The lab measures any candidate with identical methodology
— require before/after sweeps including the 4× throttle row before
accepting a choice.

## 5b. Phase 7 addendum (2026-07-23, same day) — cosmetic seam verified + a measurement lesson

The Phase 5 avatar/cosmetic resolution seam (battle-assets chain, cached;
one Map lookup per champion per frame) went live and the sweep was re-run.
The re-run's ABSOLUTE numbers came out far worse than the §2 table
(30/team 45fps, 4× throttle 3.4fps) — which triggered an immediate A/B:
the SAME sweep against the pre-P5 production deploy on the same machine at
the same time produced the SAME degraded numbers (30/team 50.9fps, 4×
throttle 3.7fps, sim cost itself 2-3× higher). Conclusion, stated plainly:

- **The cosmetic seam did not regress rendering** — P5-vs-pre-P5 differ
  only within run noise (each side wins some rows).
- **Sweep absolutes are session-relative**: the §2 baseline was captured on
  an idle machine; a loaded/thermally-throttled host shifts every number.
  From now on, ANY before/after perf claim must come from a same-machine,
  same-session A/B (production URL vs local dist is the easy recipe via
  TOUR_BASE_URL) — never from comparing absolute tables across sessions.

Phase 7 acceptance items verified: single-composed-sprite rendering
(runtime layering rejected — ARENA_COSMETIC_COMPATIBILITY.md §4), cache
keyed by every art-selecting profile field (tested), Customise changes
propagate through the idempotent store push, missing assets fall through
the tested chain, and the full gate sweep + battle/lobby/intro visual
captures are green with the seam live. Renderer-optimization steps remain
untouched per the Phase 4 decision (Step 0 device baseline pending).

## 6. Phase 3 acceptance

- Stress mode reproducible (route + chips + script, all committed).
- Results recorded (this file + baseline doc + archived JSON).
- Memory cleanup verified (§2). Cosmetic-rendering cost: N/A yet — no
  cosmetics render in-arena (Phase 5+7 will use the lab for that cost).
- Bottleneck identified with a script/layout split (§3).
- Technology decision is evidence-based and DEFERRED to Phase 4 by design.
