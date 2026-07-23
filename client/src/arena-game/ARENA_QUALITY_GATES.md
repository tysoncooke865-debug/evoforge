# Arena Quality Gates — premium program (2026-07-23)

The measurable bar the premium vertical slice must clear, and how each gate
is checked. A gate without a check command is not a gate.

## Performance (measured via the Render Stress Lab + sweep script)

| Gate | Target | Check | Status at baseline |
|---|---|---|---|
| Frame rate, normal combat | 60fps target / avg ≤16.7ms | `arena-stress-measure.mjs` density ≤20 | PASS (desktop) · UNMEASURED (device) |
| Sustained frame ceiling | no sustained >33ms in ordinary combat | same, `framesOver33` | PASS (desktop) · UNMEASURED (device) |
| 30 active combatants stable | 60fps desktop / playable device | density-30 step | PASS (desktop) · **FAIL under 4× CPU throttle (9fps)** — Phase 4 decision input |
| 40 projectiles | no collapse | ranged-fraction 0.6 @30/team saturates the 10-projectile cap + streaks | PASS (cap architecture bounds this by design) |
| 100 lightweight particles | no collapse | particle chip 150/400 | PASS (desktop, ≤+18% script) |
| Sim keeps real time | effectiveTickHz ≥ 19 | profiler HUD | PASS everywhere incl. 6× throttle |
| Memory trend | flat across 10 matches | sweep heap loop (gc-forced) | PASS (29.8MB flat) |
| Match startup | lab: intro ≤3.5s hold, battle interactive immediately after | tour timing | PASS |

## Hygiene (checked every commit — HANDOVER §5 loop)

| Gate | Check |
|---|---|
| No lingering timers after leaving Arena | timer audit (5 sites, unmount cleanup + self-termination) + store reset on unmount; stress lab adds `__ARENA_PROFILE` removal check in the sweep |
| No lingering FX/particles | FX live in refs owned by unmounted components; sweep teardown step |
| No lingering audio | vacuously true (arena is silent until Phase 15) |
| No duplicate damage | deterministic engine, digest parity, deep harness invariants |
| No duplicate rewards | `resultRecorded` guard + 'dev-stress'/'ghost' never record; P13 zero-server-write audit |
| Engine purity | `scripts/verify-arena-purity.mjs` (CI, falsified 2026-07-23) |
| No Animated loops | `scripts/verify-motion.mjs` |
| Determinism | replay digests byte-identical; deep harness `ARENA_STABILITY_DEEP=1` 0 defects |
| Balance untouched | deep-harness champion win rates vs pre-polish table (54/54/50/47/45) |

## Input (Phase 11 will add measured checks; current bar)

- One tap/deploy = one unit set; rejections always surface a visible reason
  (toast). No card deployment without confirmation from the sim
  (queue-next-tick). Optimistic UI never contradicts the sim.

## Readability floor (never traded for performance — Phase 16 rule)

Telegraphs, core-danger edges, deploy zones, health bars, ability/ultimate
readiness, ally/enemy team language: present at every future graphics tier.

## Device targets (need Tyson's hardware pass — nothing on real phones yet)

- Recent iPhone (PWA + Safari), older supported iPhone, ordinary Android.
- Small (SE-class) and large phone layouts.
- The lab ships in the bundle: debug screen → Render Stress Lab → read the
  HUD. 4×/6× desktop CPU throttle stands in until then (9.0/6.2 fps at
  30/team — the gap Phase 4 must close).
