/**
 * Battle-asset fidelity chain (premium program Phase 5/7) — PURE.
 *
 * Given a champion's art key, fielding team, and the athlete's
 * ArenaAvatarProfile, resolve which battle art to draw, walking the
 * documented fallback sequence (AVATAR_VISUAL_SOURCE_MAP.md §4):
 *
 *   1. exact profile variant (stage/skin-aware art, when generated)
 *   2. canonical path asset (today's team-outlined champion sprite)
 *   3. glyph fallback (still: null — the renderer's existing dot/letter path)
 *
 * LAYER-DRIFT RULE: a variant still NEVER mixes with canonical walk frames
 * (a stage-3 body cycling stage-1 legs is exactly the drift the premium
 * prompt forbids). A variant without its own frames renders static.
 *
 * Pure over an injected SpriteLookup so the chain is unit-testable in Node
 * (the real lookup lives in battle-assets.ts and requires PNGs, which the
 * vitest environment cannot load — same class of hazard as the Jersey-font
 * lesson in constants/theme.ts).
 */
import type { ImageSourcePropType } from 'react-native';
import type { TeamId } from '../../../game-engine/types';
import type { ArenaAvatarProfile } from '../../../integration/evoforge/avatar-profile';

export type BattleAssetFidelity = 'variant' | 'canonical' | 'fallback';

export interface ResolvedChampionAsset {
  /** null → the renderer's existing glyph/dot fallback (never a broken image). */
  still: ImageSourcePropType | null;
  walkFrames: ImageSourcePropType[] | null;
  fidelity: BattleAssetFidelity;
}

export interface SpriteLookup {
  variantStill(
    artKey: string,
    team: TeamId,
    stage: number,
    skinId: string
  ): ImageSourcePropType | null;
  variantWalk(
    artKey: string,
    team: TeamId,
    stage: number,
    skinId: string
  ): ImageSourcePropType[] | null;
  canonicalStill(artKey: string, team: TeamId): ImageSourcePropType | null;
  canonicalWalk(artKey: string, team: TeamId): ImageSourcePropType[] | null;
}

export function resolveChampionAsset(
  lookup: SpriteLookup,
  artKey: string,
  team: TeamId,
  profile: ArenaAvatarProfile | null
): ResolvedChampionAsset {
  if (profile) {
    const variant = lookup.variantStill(
      artKey,
      team,
      profile.evolutionStage,
      profile.skinId
    );
    if (variant) {
      return {
        still: variant,
        walkFrames: lookup.variantWalk(artKey, team, profile.evolutionStage, profile.skinId),
        fidelity: 'variant',
      };
    }
  }
  const canonical = lookup.canonicalStill(artKey, team);
  if (canonical) {
    return { still: canonical, walkFrames: lookup.canonicalWalk(artKey, team), fidelity: 'canonical' };
  }
  return { still: null, walkFrames: null, fidelity: 'fallback' };
}
