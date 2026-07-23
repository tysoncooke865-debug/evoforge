# Arena Cosmetic Compatibility — premium program Phases 5+7 (2026-07-23)

Per-cosmetic battle-surface support, the resolution pipeline, and the
performance decision. Owned/equipped state lives in the app (loadout store +
`user_skin_unlocks`/`user_character_unlocks`); the Arena keeps ZERO cosmetic
ownership of its own.

## 1. The pipeline (implemented)

```
useDisplayIdentity()  (app's canonical resolver — origin lock, cross-path,
   │                   premium overlay, skin gate re-validation)
   ▼  app-side arena layout: ArenaIdentityBridge (_layout.tsx)
mapDisplayToArenaProfile → ArenaAvatarProfile {path, stage 1-4, formName,
   │                        sex, skinId, premiumCharacter, visualVersion}
   ▼  setArenaAvatarProfile (idempotent push; cleared on sign-out — P13)
arenaAvatarStore  (integration/evoforge/avatar-profile.ts)
   ▼  useArenaAvatar() in arena screens
resolveChampionBattleAsset(artKey, team, profileForChampionPath(profile, path))
   │  fidelity chain (battle-assets-core.ts, pure, tested):
   │   1. exact stage/skin variant  `<art>--s<stage>[--k-<skin>]--<team>`
   │   2. canonical path asset      (today's team-outlined sprite)
   │   3. glyph fallback            (never a broken image)
   ▼  cached per artKey|team|profileKey (battle-assets.ts)
one composed battlefield sprite (single Image draw — unchanged draw cost)
```

Guards that keep it honest:
- **Own-path guard** (`profileForChampionPath`): the arena deliberately lets
  a player field ANY champion after onboarding (applyProviderIdentity
  doctrine — their pick is never overridden). The profile drives art ONLY
  for a champion of the athlete's own display path; a cross-path pick
  renders canonically. The display path DOES refine the first-run champion
  prefill (`prefillChampionFromDisplayPath`, onboarding-incomplete only).
- **Layer-drift rule**: a variant still never cycles canonical walk frames —
  variant without its own frames renders static (tested).
- **Display-only**: the profile never enters the engine, digest, or command
  log. Battle scaling still comes from the provider's avatarPath/avatarStage.

## 2. Where continuity is visible NOW (before variant art exists)

- **Lobby**: the athlete's champion card shows the app's OWN skin/stage-aware
  still (identical to Home) + "Stage N — <form name>"; arena sprite when no
  identity was pushed (standalone/mock) or the pick is cross-path.
- **Battle intro**: the player's plate carries "STAGE N — <FORM NAME>" and
  resolves art through the chain.
- **Battlefield**: the resolution seam is live; every profile resolves to the
  canonical path sprite until Phase 8 generates variants — by design.

## 3. Compatibility table (the tracking the prompt requires)

| Cosmetic class | Ids | Battle support | Portrait support | Fallback | Perf cost |
|---|---|---|---|---|---|
| Skins (recolours) | 8/line × 5 lines (`domain/customise.ts::SKINS`) | **not yet** — resolves canonical until Phase 8+ generates `--k-<skin>` variants (precomposed recolour at generation time) | **yes** — lobby still IS the app's skinned art | canonical path sprite | zero (same single draw) |
| Evolution stages | 1-4 per line | **not yet** — `--s<stage>` variants are Phase 8's golden pipeline | **yes** — stage line + app still | canonical path sprite | zero |
| Premium character (Gymerica) | `gymerica` (2 looks) | **no** — no arena battle sprite; documented fallback | **yes** — lobby still shows Gymerica (the app still already renders it) | canonical path sprite of the athlete's real branch | zero |
| Auras | `AURAS` | **no** — no battle analog yet; candidate: base-plate tint (Phase 8 decision, needs art-bible rule) | n/a | none (absent) | — |
| Emotes | companion animations | **n/a** — no battle surface by design | n/a | — | — |
| Effects (podium…) | `EFFECTS` | **n/a** — Home podium only | n/a | — | — |
| Palettes (app themes) | `PALETTE_IDS` | **n/a** — whole-app theming, not champion art | n/a | — | — |
| Female variants | app art: aesthetic line only | **blocked app-wide** — the arena cannot invent art the app lacks; sex rides the profile for when art exists | partial (app stills where they exist) | male-form sprite | — |

## 4. Phase 7 performance decision — PRECOMPOSED, single sprite

The prompt's preferred approach (precomposed battle atlas) is adopted; its
alternative (synchronised runtime layers) is REJECTED for this app:

- This app's cosmetics are **recolours + one premium character** — there are
  no per-slot gear cosmetics (head/torso/weapon…) to layer. Recolouring
  pixel art is a generation-time operation (the PixelLab pipeline
  post-processes sprites already; a skin variant is one more precomposed
  PNG), so runtime compositing would add cost for zero capability.
- Runtime cost of the implemented pipeline: ONE Map lookup per champion per
  frame (cache-keyed by profile), one Image draw — identical to before.
  Verified: full gate sweep + stress lab re-run green with the seam live
  (see ARENA_STRESS_TEST_REPORT.md addendum).
- Cache invalidation: keys include every art-selecting profile field
  (`arenaProfileKey` — formName excluded, tested), so a Customise change
  simply selects a different key; no explicit invalidation needed.

## 5. What Phase 8 must deliver against this contract

Stage variants (`--s2..s4`) for the golden champion first (canonical art IS
stage 1's), each with its own 4 walk frames or none (drift rule); skin
variants as generation-time recolours; an aura-in-battle ruling in the art
bible; Gymerica battle-sprite yes/no decision. Registered in sprites.ts —
the chain and every surface pick them up with zero further wiring.
