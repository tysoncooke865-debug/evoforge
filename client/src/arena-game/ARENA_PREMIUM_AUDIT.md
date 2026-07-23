# Arena Premium Audit — Phase 1 of the premium program (2026-07-23)

The evidence-first audit for the 19-phase "premium mobile quality" program.
Supersedes nothing: `ARENA_VISUAL_AUDIT.md` (polish pass) remains the visual
history; this document records what the repository ACTUALLY contains at the
start of the premium program, including two discoveries that correct earlier
program assumptions. Companion docs: `ARENA_RENDER_ARCHITECTURE.md`,
`ARENA_PERFORMANCE_BASELINE.md`, `ARENA_QUALITY_GATES.md`,
`ARENA_GOLDEN_SLICE_PLAN.md`, `AVATAR_VISUAL_SOURCE_MAP.md`,
`KNOWN_ARENA_ISSUES.md`, `ARENA_STRESS_TEST_REPORT.md`.

## 1. Where the Arena stands entering the program

Twelve polish phases (commits `93877b3`→`6b8a9fb`) already delivered: PixelLab
pixel art (5 champions / 10 units / cores / floor, 75 crushed PNGs), an
impact-tier combat-feel ladder with replay-safe time dilation, per-path FX
identity, battle intro + result ceremony + core-destruction climax, full-bleed
UI with the Jersey pixel faces, and gym-war attribution. Deep harness:
362/362 matches, champion win rates identical to pre-polish. The Arena is a
presentable vertical slice on desktop web; nothing is verified on phone
hardware.

## 2. Discovery A — the wider app has a full avatar system the Arena ignores

The premium prompt assumed this; the audit CONFIRMS it exists (it was absent
from every prior arena program doc):

- **5 classes × 4 evolution stages with real art**: `src/ui/character/avatar-art.ts`
  (per-stage rotation GIFs + stills, male complete, female aesthetic-line only),
  `avatar-images.ts` (legacy stills), `sprite-avatar.tsx` (animated pixel
  companion, web CSS-steps + native Reanimated paths).
- **A paid cosmetic system with server-side ownership**: `src/domain/customise.ts`
  (skins ×8/line, auras, emotes, effects, palettes, premium character
  Gymerica), `state/loadout-store.ts` (equipped loadout), Supabase tables
  `user_skin_unlocks` / `user_character_unlocks` (+RPCs, migrations 030/031/044),
  palette-swap recolour tables in `ui/character/avatar-skins.ts`.
- **One canonical resolver**: `src/data/use-display-identity.ts` — applies
  loadout + origin lock + premium overlay and feeds Home, Forge, Customise.
  Output shape: `{branch, stage, sex, skinId, character}` + resolved art
  sources.
- **The Arena reads none of it.** `integration/evoforge/supabase-provider.ts`
  reads `profiles.origin_path` only → every player's champion renders the
  same path sprite regardless of evolution stage, sex, or equipped skin.

Full mapping + the premium-prompt interface reconciliation:
`AVATAR_VISUAL_SOURCE_MAP.md`. This is the Phase 5 work package.

## 3. Discovery B — the app already has an audio system

`src/ui/core/sound.ts`: a synthesized Web-Audio SFX engine (oscillator/noise,
no assets, web-only, silent on native until an `expo-audio` build), gated by
`useSettingsStore().soundEnabled`, already used across the main app
(hit/crit/heal/victory/level-up/purchase...). The polish-pass record said "no
audio anywhere" — wrong at app level (correct within the arena package).
Phase 15 can extend an existing, settings-gated precedent rather than
introducing audio from zero. The public-gym default-volume question remains
Tyson's call.

## 4. Render-path census (the premium program's engineering ground truth)

Verified by direct code inspection (file:line in `ARENA_RENDER_ARCHITECTURE.md`):

- **Loop**: `battle-store.ts` — `setInterval(50ms)`, wall-clock→tick-debt
  accumulator (dilation-aware, catch-up cap 5), `stepLiveBattle` mutates the
  `LiveBattle` in place, publishes ONE Zustand write per frame (`version+1`).
- **Single subscriber, whole-tree re-render**: only `ArenaScreen` subscribes;
  every child re-renders every 50ms via props. Zero `React.memo`/`useMemo`
  in the battle tree (deliberate `'use no memo'` opt-outs). The HUD (cards,
  energy, timer, champion panel) re-renders every tick regardless of change.
- **Node budget**: ~6-9 RN nodes per unit/champion, 3 per projectile, 3-9 per
  telegraph, 1-3 per floater, ~5 scenery per lane. FX state lives in one
  `useRef`, mutated in-render by `collectCombatFx` over the log delta; caps
  12 floaters / 12 pings / 4 telegraphs / 8 poofs / 10 projectiles; no
  pooling (per-frame `.filter`/`.slice` allocations).
- **All motion is `Date.now()`-aged inline styles** — no Animated/Reanimated/
  rAF in runtime code (verify-motion green); the doctrine that replaced
  per-effect timers in the polish pass.
- **Engine purity**: `game-engine/` has zero react/RN imports — now ENFORCED
  by `scripts/verify-arena-purity.mjs` in CI (falsified once).
- **Memory vector**: the battle log is append-only and never pruned during a
  match (~4.5 entries/tick at 40/team ≈ 16k entries in a 3-min stress match);
  freed when the `LiveBattle` is dropped. Measured: heap flat at 29.8MB
  across 10 consecutive stress matches — no leak.

## 5. Measured baseline (details in ARENA_PERFORMANCE_BASELINE.md)

Desktop Chromium, production web export, 390×844 viewport:

| Condition | fps avg | 1% low | worst frame | script (1 core) |
|---|---|---|---|---|
| Normal combat (~20 units) | 60.0 | 59.5 | 17ms | ~13% |
| 30/team (60 alive + champs) | 60.0 | 59.5 | 17ms | ~20% |
| 40/team (80 alive) | 59.0 | 30.0 | 33ms | ~34% |
| 30/team + 150 particles, **4× CPU throttle** | **9.0** | 6.0 | 167ms | 76% |
| same, 6× throttle | 6.2 | 3.7 | 267ms | ~sat. |

Simulation cost is trivial at every density (≤1.1ms/frame even throttled;
`effectiveTickHz` holds 20 — the game never slows, it renders choppy).
Browser layout+style stay under 5% combined. **The bottleneck is script: the
whole-tree React re-render at 20Hz.** This is the central fact for the
Phase 4 renderer decision.

## 6. What must NOT be touched without evidence (stable systems)

- The deterministic engine + digest/replay contract (rejected-never-thrown,
  queue-next-tick, digest reads no log entries).
- Balance: `BALANCE` tables, `DEFAULT_DECK_CARD_IDS` (AI deck is
  balance-coupled), champion stats (TENDENCY-only tuning rule).
- The P13 reward-safety contract: arena package makes zero server writes;
  Arena Rating stays local + cosmetic.
- The frame-driven FX doctrine (no Animated loops; verify-motion).
- The fitness-tracking app around the arena (XP curve goldens, RLS, provider).

## 7. Gaps vs the premium prompt's expectations (honest deltas)

1. **Avatar continuity** (Phase 5-8): arena art keys on path only — no stage,
   sex, skin, or premium-character awareness. Largest identity gap.
2. **No audio in the arena** (Phase 15): app-level synth system exists; the
   arena is silent by explicit deferral (public-gym context, A3).
3. **Whole-tree re-render** (Phase 2/4): fine on desktop; collapses on
   throttled CPU. Optimization candidates are documented, not applied —
   Phase 4 decides the path with the stress evidence.
4. **testIDs**: the stress lab ships fully test-ID'd; the production battle
   screen still has none (R2, highest-value cheap follow-up).
5. **No graphics tiers** (Phase 16), **no visual regression harness**
   (Phase 17) — future phases, unblocked by this audit.
6. **Nothing verified on phone hardware** — every figure above is desktop
   Chromium; the 4×/6× throttle rows are proxies, not devices.

## 8. Phase 1 acceptance

- Audit reflects the actual repository (two assumption-corrections recorded).
- Quality gates are measurable: `ARENA_QUALITY_GATES.md`.
- Avatar sources mapped: `AVATAR_VISUAL_SOURCE_MAP.md`.
- Stable systems identified (§6). Renderer risks documented (§5, §7.3).
- Golden-slice scope locked: `ARENA_GOLDEN_SLICE_PLAN.md`.
- Repository runnable: full gate sweep green on this commit.
