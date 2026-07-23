# Avatar Visual Source Map — premium program Phase 1 (2026-07-23)

What the EvoForge app ACTUALLY has for champion identity, where it lives,
and how the Arena must consume it (Phase 5+). This corrects the arena
program's standing assumption that no avatar/cosmetic system existed.

## 1. The canonical chain (wider app — all real, shipped code)

```
progression data (workouts, body-fat, level, origin record)
  └─ src/data/use-avatar-data.ts        → branchV2, sex, stats, level
      └─ src/domain/branches-v2.ts      → 5 classes: aesthetic | mass | titan | cardio | shredder
                                          stage math: massArtStage (level→1-4), shredderStage (body-fat)
  └─ src/data/origin.ts + path-sync.ts  → server Origin record (origin_path/active_path/active_stage,
                                          monotonic — earned stages never regress)
  └─ src/state/loadout-store.ts         → equipped Loadout (persisted, cleared on sign-out)
  └─ src/data/skins.ts / characters.ts  → owned skins (user_skin_unlocks, RPC purchase_skin,
                                          migration 030) / premium characters (user_character_unlocks, 031)
      └─ src/data/use-display-identity.ts  ★ THE RESOLVER ★
          → { ready, sex, derived, display: {branch, stage, skinId, character},
              animatedSource, stillSource, paintedSource, hasArt }
```

Art assets behind the resolver:
- `src/ui/character/avatar-art.ts` — per-class × stage (1-4) rotation GIFs +
  stills (`assets/sprites/{aesthetic,mass-monster,titan,shredder,cardio}/`).
  Male: real art for all 5 lines. Female: real art for the aesthetic line;
  other lines silhouette a donor shape (`hasArt=false`).
- `src/ui/character/avatar-skins.ts` — lazy palette-swap recolours per line
  (8 skin ids/line from `domain/customise.ts::SKINS`).
- `src/ui/character/gymerica-art.ts` — the premium character overlay.
- `src/ui/character/sprite-avatar.tsx` — animated pixel companion
  (idle/run/punch/victory strips; web CSS-steps / native Reanimated).

Cosmetic taxonomy (`src/domain/customise.ts`): skins (recolours), auras,
emotes (companion animations), effects (podium; others marked "incoming"),
palettes (whole-app themes), premium characters. **There are NO per-slot
gear cosmetics (head/torso/weapon/back)** — the premium prompt's
`equippedCosmetics {head, torso, ...}` interface does not match this app.

## 2. What the Arena consumes today (the gap)

`integration/evoforge/supabase-provider.ts` reads `profiles.origin_path`
ONLY → `branchToAvatarPath()` → one PixelLab sprite per path
(`features/arena/components/sprites.ts`, team-keyed). Ignored entirely:
evolution stage, sex, skinId, premium character, loadout. Gym-mate paths are
hash-synthesized ("(EST.)") pending the `gym_detail origin_path` migration
(KNOWN_ISSUES #4, needs Tyson).

## 3. The real AvatarVisualProfile (Phase 5 target shape)

The prompt's interface, reconciled to what exists:

```ts
interface ArenaAvatarProfile {
  playerId: string;
  championPath: 'aesthetic' | 'mass' | 'titan' | 'cardio' | 'shredder'; // BranchV2 slugs (NOT the prompt's underscored names)
  evolutionStage: 1 | 2 | 3 | 4;
  sex: 'male' | 'female';
  skinId: string;              // 'standard' | one of SKINS[line]
  premiumCharacter: string | null; // e.g. 'gymerica' — overrides art wholesale
  visualVersion: number;       // bump when the resolver's inputs change shape
}
```

Sourcing rule: **Arena must read `useDisplayIdentity()` (or a provider-side
equivalent of its resolution) — never re-derive.** Owned/equipped state
lives in the existing stores/tables; the Arena adds NO cosmetic ownership of
its own (prompt rule + P13 zero-write contract).

## 4. Hierarchy when sources conflict (per the prompt, mapped to reality)

1. Equipped loadout via `resolveDisplay` (it already re-validates gates and
   falls back to the derivation — conflicts self-heal).
2. Origin server record (monotonic stage; cross-path equip).
3. Derived branch/stage from live progression.
4. Arena path sprite for that class (current behavior = the final fallback).
5. Existing colored-dot/letter-glyph fallback (never a broken image).

## 5. Phase 5-8 implications (scope facts, not commitments)

- Arena needs stage-aware (and ideally sex/skin-aware) battle sprites: up to
  5 classes × 4 stages (× sex × skins later). The PixelLab pipeline
  (`scripts/arena-pixellab-gen.mjs`, seed-pinned, idempotent) is the
  generation path; the wider app's per-stage stills are the identity
  reference each generation must match.
- Female art outside the aesthetic line does not exist app-wide — the arena
  cannot invent it; silhouette-fallback parity is the honest floor.
- Palette-swap skins map naturally onto pixel art (recolour tables already
  exist app-side); auras have an arena analog (aura ring); emotes/palettes
  have no battle surface; Gymerica needs one battle sprite set or an
  explicit documented fallback.
- Gym Champions/Rivals need a `BattleAvatarSnapshot` (owner appearance at
  battle time) — blocked on the same `gym_detail` migration for real paths.
