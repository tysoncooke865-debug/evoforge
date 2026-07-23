/**
 * Battle-asset resolution bound to the real sprite registry (premium
 * program Phase 5/7). The chain logic is pure in battle-assets-core.ts;
 * this binding adds the registry lookup + a keyed cache so per-frame
 * champion renders never re-walk the chain (Phase 7's performance-safe
 * requirement: cosmetics add ZERO per-frame resolution cost — one composed
 * sprite, precomposed at generation time, cache-keyed by profile).
 *
 * Variant naming contract (ARENA_ART_BIBLE.md): stage/skin champion
 * variants register as `<artKey>--s<stage>[--k-<skinId>]--<team>` with walk
 * frames `...--w0..w3`. Until Phase 8 generates them, every profile
 * resolves to the canonical path asset — by design, not by accident.
 */
import type { TeamId } from '../../../game-engine/types';
import {
  arenaProfileKey,
  type ArenaAvatarProfile,
} from '../../../integration/evoforge/avatar-profile';
import {
  resolveChampionAsset,
  type ResolvedChampionAsset,
  type SpriteLookup,
} from './battle-assets-core';
import {
  championSprite,
  championSpriteVariant,
  championWalkFrames,
  championWalkFramesVariant,
} from './sprites';

const registryLookup: SpriteLookup = {
  variantStill: (artKey, team, stage, skinId) => championSpriteVariant(artKey, team, stage, skinId),
  variantWalk: (artKey, team, stage, skinId) =>
    championWalkFramesVariant(artKey, team, stage, skinId),
  canonicalStill: (artKey, team) => championSprite(artKey, team),
  canonicalWalk: (artKey, team) => championWalkFrames(artKey, team),
};

const cache = new Map<string, ResolvedChampionAsset>();

export function resolveChampionBattleAsset(
  artKey: string,
  team: TeamId,
  profile: ArenaAvatarProfile | null
): ResolvedChampionAsset {
  const key = `${artKey}|${team}|${profile ? arenaProfileKey(profile) : '-'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = resolveChampionAsset(registryLookup, artKey, team, profile);
  cache.set(key, resolved);
  return resolved;
}
