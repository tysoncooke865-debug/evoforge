import type { ImageSourcePropType } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';

/**
 * Static require() map -- Metro resolves assets at build time, so no dynamic
 * paths. Mirrors ui/avatar_images.py :: AVATAR_ASSETS, including the fallback:
 * an unknown branch/stage renders aesthetic stage 1 rather than crashing.
 * mass/hybrid are the avatar_assets/ PNGs copied verbatim; the aesthetic line
 * is the FRONT pose cropped from Tyson's Cyber Athlete LV.1-4 sheets (the
 * same sheets the SpriteCompanion animations are sliced from), so the main
 * avatar and the companion sprite are the same character per stage.
 */
const AVATAR_ASSETS: Record<Branch, Record<number, ImageSourcePropType>> = {
  aesthetic: {
    1: require('../../assets/avatars/aesthetic_front_stage_1.png'),
    2: require('../../assets/avatars/aesthetic_front_stage_2.png'),
    3: require('../../assets/avatars/aesthetic_front_stage_3.png'),
    4: require('../../assets/avatars/aesthetic_front_stage_4.png'),
  },
  mass: {
    1: require('../../assets/avatars/mass_stage_1.png'),
    2: require('../../assets/avatars/mass_stage_2.png'),
    3: require('../../assets/avatars/mass_stage_3.png'),
  },
  hybrid: {
    1: require('../../assets/avatars/hybrid_stage_1.png'),
    2: require('../../assets/avatars/hybrid_stage_2.png'),
    3: require('../../assets/avatars/hybrid_stage_3.png'),
  },
};

export function avatarImage(branch: Branch, stage: number): ImageSourcePropType {
  const line = AVATAR_ASSETS[branch] ?? AVATAR_ASSETS.aesthetic;
  // Clamp to the line's own top stage: the mass line's V2 ladder reaches
  // art stage 4 (sprites) while the painted set stops at 3 — the old
  // fallback dressed a stage-4 Mass Monster in aesthetic stage 1.
  const top = Math.max(...Object.keys(line).map(Number));
  return line[Math.max(1, Math.min(top, Math.trunc(stage)))] ?? AVATAR_ASSETS.aesthetic[1];
}

/**
 * THE SHREDDER's four forms -- stage progresses as BODY FAT drops, not level.
 * Art has baked backgrounds (not transparent): render as-is on the dark
 * stage; never tint-silhouette these (a solid box results). Transparent
 * exports would unlock full staging effects -- see PARITY.md.
 */
const SHREDDER_ASSETS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/avatars/shredder_stage_1.png'),
  2: require('../../assets/avatars/shredder_stage_2.png'),
  3: require('../../assets/avatars/shredder_stage_3.png'),
  4: require('../../assets/avatars/shredder_stage_4.png'),
};

export function shredderImage(stage: number): ImageSourcePropType {
  return SHREDDER_ASSETS[stage] ?? SHREDDER_ASSETS[1];
}
