# Arena Golden Slice Plan — the 19-phase premium program mapped to this repo

Locked scope for the premium vertical slice (2026-07-23). The operator
prompt's phases, reconciled against what already exists after the 12-phase
polish pass. Rule of the program: **no art mass-production before the
Phase 4 renderer decision; no renderer rewrite before the stress evidence.**

## The slice (what "done" contains)

One excellent complete match: the existing two-lane arena at final quality,
five official champions (Aesthetics / Titan / Mass Monster / The Shredder /
Cardio Machine) visually faithful to the player's REAL champion (stage +
equipped cosmetics), twelve polished core cards, premium combat feedback +
audio, stable 60fps-target performance on target devices, reliable repeat
matches, correct Gym Champion presentation. No new modes, no monetisation,
no real-time multiplayer, no progression duplication.

## Phase map (status + where the work lands)

| Phase | Scope in this repo | Status |
|---|---|---|
| 1 Audit+gates | ARENA_PREMIUM_AUDIT / PERFORMANCE_BASELINE / QUALITY_GATES / AVATAR_VISUAL_SOURCE_MAP / KNOWN_ARENA_ISSUES + profiler infra | **DONE this session** |
| 2 Render architecture | ARENA_RENDER_ARCHITECTURE.md + engine-purity CI guard; churn reductions deliberately deferred to evidence | **DONE this session** |
| 3 Stress benchmark | Render Stress Lab (dev-stress mode/screen/driver) + headless bench + browser sweep + ARENA_STRESS_TEST_REPORT.md | **DONE this session** |
| 4 Renderer decision | Independent review of the stress evidence → ARENA_RENDERER_DECISION.md. Options on the table: (a) targeted memoization/subscription-gating of the existing RN-view path (evidence: cost is script, layout <5%), (b) Skia canvas battlefield (new dep: native + CanvasKit WASM on web — weigh against the PWA delivery). | NEXT — Opus 4.8 xhigh |
| 5 Avatar source of truth | ArenaAvatarProfile fed from useDisplayIdentity (see AVATAR_VISUAL_SOURCE_MAP §3); no arena-side ownership | open |
| 6 Art bible | ARENA_ART_BIBLE.md — pixel rules already practiced by the PixelLab pipeline, formalized; champion-continuity sections keyed to the app's per-stage art | open |
| 7 Cosmetic rendering | Palette-swap recolours (precompose at build/generation time via the pipeline — runtime layering likely unnecessary for recolour-class cosmetics) | open |
| 8 Golden champion | One champion (strongest asset set) through stage-aware generation + all surfaces; GOLDEN_CHAMPION_VISUAL_REVIEW.md | open |
| 9 Animation system | Extend the sim-synced procedural system (attack/hit/spawn/walk exist); add state machine + event markers only if Phase 4 keeps the current renderer | open |
| 10 Combat feedback | Impact-tier ladder EXISTS (impact.ts); premium pass = pooling if Phase 4 demands, shield-break/heal polish, champion-specific ultimates review | open |
| 11 Card input | Deployment audit (tap-based today; drag optional), testIDs across the battle screen (R2) | open |
| 12 Golden arena+HUD | Floor variant (R3), HUD spacing, safe-area audit | open |
| 13 Five champions | Mass-produce ONLY after Phase 8 passes | open |
| 14 Twelve cards | 20 cards exist; slice curates/polishes 12 (art already matches battlefield sprites by construction) | open |
| 15 Audio | Extend ui/core/sound.ts synth precedent into the arena (settings-gated); Tyson's public-gym call stands | open — needs Tyson |
| 16 Graphics tiers | Perf-mode integration (app has perfMode + useAmbient precedent) | open |
| 17 Visual regression | Deterministic scenes + golden screenshots (stress lab's seeded battles are the natural harness) | open |
| 18 Hardening | 1,000 headless battles = deep-harness extension; rendered stress loops = the lab | open |
| 19 Final audit | ARENA_PREMIUM_BUILD_REPORT.md | open |

## Session grouping (per the operator prompt)

- **Session 1 (this one, Fable 5): Phases 1-3. STOPS after the stress report.**
- Session 2: Phase 4 — Opus 4.8, xhigh, independent.
- Sessions 3+: as scheduled in the prompt; art production gated on Phase 4+8.

## Standing constraints carried into every phase

Official champions only (never Hybrid/Speedster player-facing); engine
determinism + digest contract; balance via TENDENCY/stat-lever discipline
with the deep harness as arbiter; zero arena server writes; no Animated
loops; PixelLab pipeline idempotent + seed-pinned; smoke accounts never
create gyms; repo left runnable every commit.
