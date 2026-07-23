# Arena Performance Baseline — premium program Phase 1 (2026-07-23)

Reproducible baseline BEFORE any premium-program optimization. Every figure
is desktop Chromium against the production web export (390×844 viewport)
unless marked otherwise. **Nothing in this file is a phone-hardware
measurement** — the CPU-throttled rows are proxies and say so.

## How to reproduce

```powershell
# Headless JS costs (engine + render derivations):
$env:ARENA_STRESS_BENCH='1'; npx vitest run src/arena-game/__tests__/stress-bench.test.ts

# Browser sweep (fps / frame times / script-layout split / heap trend):
npx expo export -p web
npx serve "<abs>/client/dist" -l 4173
node scripts/arena-stress-measure.mjs <out-dir>   # needs playwright installed nearby
```

Manual: /forge-arena/debug → "Render Stress Lab" (or /forge-arena/dev-stress);
the on-screen HUD shows the same numbers. `window.__ARENA_PROFILE.snapshot()`
in the console gives the raw object.

## Headless JS cost per tick (Node, vitest bench)

| units/team | median alive | sim avg µs | sim worst µs | fx-derive avg µs | offsets µs | log entries/tick |
|---|---|---|---|---|---|---|
| 10 | 22 | 64.5 | 1491 | 15.4 | 21.5 | 1.1 |
| 20 | 40 | 45.2 | 692 | 7.1 | 13.6 | 2.4 |
| 30 | 58 | 42.4 | 387 | 6.2 | 15.4 | 3.4 |
| 40 | 76 | 31.0 | 179 | 7.7 | 19.8 | 4.5 |

(Worst-µs spikes are JIT warm-up on the first density; averages are the
signal.) Total JS derivation cost at the 40/team worst case ≈ 0.06ms of the
50ms tick budget — **the simulation and the pure render-derivation layer are
performance non-issues at every planned density.**

## Browser measurements (production export, desktop Chromium)

| Condition | fps avg | 1% low | frame avg | worst | >33ms | sim ms | publish ms | tickHz | script %core | layout+style % |
|---|---|---|---|---|---|---|---|---|---|---|
| 10/team (~21 alive) | 60.0 | 59.5 | 16.7 | 17 | 0 | 0.10 | 0.08 | 20.0 | 13 | 1.3 |
| 20/team (~40) | 60.0 | 59.5 | 16.7 | 17 | 0 | 0.14 | 0.07 | 20.0 | 13 | 1.3 |
| 30/team (~60) | 60.0 | 59.5 | 16.7 | 17 | 0 | 0.10 | 0.07 | 20.0 | 20 | 1.8 |
| 40/team (~80) | 59.0 | **30.0** | 17.0 | 33 | 9 | 0.11 | 0.07 | 20.0 | 34 | 3.0 |
| 30/team + 150 particles | 59.9 | 49.7 | 16.7 | 33 | 1 | 0.11 | 0.08 | 20.0 | 41 | 4.2 |
| 30/team + 400 particles | 60.0 | 59.5 | 16.7 | 17 | 0 | 0.13 | 0.09 | 20.0 | 37 | 4.6 |
| **4× CPU throttle**, 30/team +150p | **9.0** | 6.0 | 111.6 | 167 | all | 0.48 | 0.20 | 19.9 | 78 | 7.6 |
| **6× CPU throttle**, same | **6.2** | 3.7 | 162.5 | 267 | all | 1.03 | 0.31 | 19.7 | ~sat | 8.1 |

Memory: JS heap flat at **29.8MB across 10 consecutive fresh stress matches**
(each restart verified by tick counter; gc forced before each reading).
Teardown: leaving the lab removes `__ARENA_PROFILE` and the store frame hook.

## Reading the table (the facts that matter)

1. **Desktop holds 60fps up to 30/team + 400 synthetic particles.** First
   visible strain at 40/team (1% low 30fps, nine >33ms frames).
2. **The sim never falls behind** — `effectiveTickHz` stays ~20 even at 6×
   throttle. Overload manifests as choppy rendering, never as slow gameplay.
3. **The cost is script, not paint**: browser layout+style stay under 5% of a
   core in every condition; script scales 13%→34% with density and saturates
   under throttle. The per-frame cost is the whole-tree React re-render
   (ArenaScreen subtree, zero memoization), NOT the browser pipeline and NOT
   the sim.
4. **`publishMs` is scheduling only** (~0.1ms): React 19 does not flush
   subscribers synchronously inside the Zustand `set()`. The real render cost
   shows up in the rAF cadence. (This falsified the initial design
   assumption; recorded so nobody re-trusts publishMs as a commit proxy.)
5. **4×/6× CPU throttle ≈ mid/low-tier phone-class silicon**: 9.0/6.2 fps.
   The current renderer has NO headroom there. iPhone-class single-core
   performance is near desktop, which is why Tyson's PWA feels fine —
   mid-range Android is the risk envelope.

## What still needs physical hardware

Frame rate/touch latency on a recent iPhone, an older supported iPhone, and
an ordinary Android; PWA vs Expo Go deltas; thermal throttle behavior; input
latency under load. The lab ships in the bundle (debug → Render Stress Lab)
so a device pass needs zero extra tooling — open the lab on the phone and
read the HUD.
