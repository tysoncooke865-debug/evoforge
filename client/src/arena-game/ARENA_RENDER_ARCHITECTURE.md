# Arena Render Architecture — premium program Phase 2 (2026-07-23)

The as-is rendering architecture, documented and enforced. No rewrites were
performed in this phase — by the program's own rules ("do not optimise
before a reproducible baseline", "preserve stable systems unless profiling
proves modification necessary"), optimization is Phase 4's decision, made on
the Phase 3 evidence in `ARENA_STRESS_TEST_REPORT.md`.

## 1. The pipeline (as-is)

```
game-engine/ (pure TS, deterministic, 50ms ticks)      ← CI-enforced pure: verify-arena-purity.mjs
    │  stepLiveBattle() mutates LiveBattle in place; append-only event log
    ▼
features/arena/battle-store.ts (Zustand vanilla)
    │  setInterval(50ms) → wall-clock→tick-debt accumulator (time-dilation aware,
    │  catch-up cap 5) → ONE publish per frame: set({version: v+1})
    ▼
features/arena/components/arena-screen.tsx (THE single subscriber)
    │  re-renders the whole battle tree at ≤20Hz; collectCombatFx mutates a
    │  useRef FxState from the log delta (pure deriveCombatSignals);
    │  shake/flash/dilation requests flow store-ward, never sim-ward
    ▼
lane-strip.tsx ×2 + core-bar ×2 + HUD (cards/energy/timer/champion)
    │  plain RN Views/Images; all motion Date.now()-aged inline styles;
    │  ~6-9 nodes per combatant; FX caps 12/12/4/8/10; no pooling
    ▼
RN-web DOM (prod) / native views (Expo Go)
```

Mapped to the premium prompt's preferred architecture:

| Prompt | This repo | Verdict |
|---|---|---|
| Pure deterministic TS simulation | game-engine/ (now CI-guarded) | ✓ |
| Compact render snapshot | version counter over a mutable LiveBattle (no copy) | deviation — cheap (zero-copy) but couples render reads to sim internals |
| Single high-performance renderer | RN view tree re-rendered whole at 20Hz, zero memoization | ✓ shape / ✗ headroom (see baseline: script-bound at 4× throttle) |
| Static/low-frequency React HUD | HUD re-renders every tick with the tree | ✗ — candidate optimization |

## 2. Boundary rules (all hold today; keep them true)

- **Rendering cannot apply damage**: components never call engine mutators;
  player intent goes through queue-next-tick commands only.
- **VFX cannot determine combat results**: FxState is derived FROM the log;
  nothing reads it back into the sim. Time dilation DELAYS ticks, never
  skips them (replay-safe, tested).
- **Simulation never waits on animation**: procedural poses derive from sim
  fields (attackCooldownTicks, spawnedAtTick); no completion callbacks.
- **Identical seed + command stream → identical digest**: enforced by replay
  tests + deep harness; the digest reads NO log entries, so log-extension
  for FX stays digest-safe.
- **Cosmetics must not create simulation differences**: trivially true today
  (no cosmetics in arena); Phase 5 must keep profile data OUT of digested
  state (precedent: `ownerName` is display-only, undigested).
- **Engine purity is now CI**: `scripts/verify-arena-purity.mjs` fails the
  build if game-engine/ imports react/react-native/expo/zustand (falsified
  2026-07-23).

## 3. Module boundaries (prompt taxonomy → repo reality)

simulation=`game-engine/` · rendering/vfx=`features/arena/components/`
(impact.ts, combat-fx.ts, readability.ts are the pure derivation layer) ·
input=`battle-store` commands + lane Pressables · content/balance=`content/`
· profiling=`features/arena/dev/` (NEW: frame-profiler, stress-driver) ·
replays=`game-engine/simulation/replay.ts` + battle-records · audio=none yet
(Phase 15; app precedent `src/ui/core/sound.ts`) · avatars/cosmetics=wider
app (`AVATAR_VISUAL_SOURCE_MAP.md`), arena integration is Phase 5.

## 4. Why the whole-tree re-render exists (and when it stops being fine)

The polish pass chose store-driven re-render + wall-clock-aged styles over
per-effect timers/Animated loops to make FX deterministic, teardown-safe,
and replay-neutral — and at 20Hz on desktop it measures at 60fps up to 80
combatants. The stress evidence shows its limit: script cost (component
re-execution + style allocation across the whole tree) saturates a
phone-class core (9fps at 4× throttle). The doctrine (frame-driven,
log-derived, no loops) is worth keeping; the *whole-tree* part is the
negotiable half.

## 5. Evidence-gated optimization candidates (for Phase 4 — NOT applied)

Ranked by expected script reduction per unit of risk:

1. **Memoize UnitMarker/ProjectileMarker/TelegraphMarker** on narrow value
   props (id, x, health, pose inputs, ageMs bucket). Caveat: naive memo is
   defeated because every marker's style depends on `Date.now()` — the fix
   is passing a quantized `frameNowMs` prop so unchanged units bail out.
2. **Split the HUD out of the battle subscription**: cards/energy/timer
   change at most once per tick and usually less; subscribe them to derived
   selectors (energy int, hand ids, seconds) instead of `version`.
3. **Static scenery extraction**: floor/lanes/deploy zones re-render every
   frame today; they change only with selection state.
4. **Style-object pooling / StyleSheet reuse** for the hot markers (every
   frame allocates fresh style objects per node).
5. **Skia canvas battlefield** (the prompt's preference): one canvas, sprite
   atlas, JS-driven draw loop. Solves script cost structurally; costs a new
   native dependency + CanvasKit WASM (~2MB) on the PWA path, a rewrite of
   the battlefield layer, and re-verifying the whole FX doctrine. Justified
   only if 1-4 measurably cannot reach the device gate.

Phase 4 (Opus, independent) picks; the lab measures before/after with
identical methodology.

## 6. Phase 2 acceptance

- Architecture documented (this file) with the prompt-mapping table.
- Per-frame churn: measured and bounded (baseline doc); reductions are
  listed, evidence-gated, deliberately not applied pre-decision.
- One clear performance path for the battlefield: the store→screen seam is
  the single choke point either option optimizes.
- Simulation determinism intact: deep harness green on this commit.
- Arena remains integrated; no unrelated features touched.
