import type { ImageSourcePropType } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';

/**
 * The same 10 PNGs as avatar_assets/ (copied verbatim; the plan keeps them).
 * Static require() map -- Metro resolves assets at build time, so no dynamic
 * paths. Mirrors ui/avatar_images.py :: AVATAR_ASSETS, including the fallback:
 * an unknown branch/stage renders aesthetic stage 1 rather than crashing.
 */
const AVATAR_ASSETS: Record<Branch, Record<number, ImageSourcePropType>> = {
  aesthetic: {
    1: require('../assets/avatars/aesthetic_stage_1.png'),
    2: require('../assets/avatars/aesthetic_stage_2.png'),
    3: require('../assets/avatars/aesthetic_stage_3.png'),
    4: require('../assets/avatars/aesthetic_stage_4.png'),
  },
  mass: {
    1: require('../assets/avatars/mass_stage_1.png'),
    2: require('../assets/avatars/mass_stage_2.png'),
    3: require('../assets/avatars/mass_stage_3.png'),
  },
  hybrid: {
    1: require('../assets/avatars/hybrid_stage_1.png'),
    2: require('../assets/avatars/hybrid_stage_2.png'),
    3: require('../assets/avatars/hybrid_stage_3.png'),
  },
};

export function avatarImage(branch: Branch, stage: number): ImageSourcePropType {
  return AVATAR_ASSETS[branch]?.[stage] ?? AVATAR_ASSETS.aesthetic[1];
}

/**
 * THE SHREDDER's four forms -- stage progresses as BODY FAT drops, not level.
 * Art has baked backgrounds (not transparent): render as-is on the dark
 * stage; never tint-silhouette these (a solid box results). Transparent
 * exports would unlock full staging effects -- see PARITY.md.
 */
const SHREDDER_ASSETS: Record<number, ImageSourcePropType> = {
  1: require('../assets/avatars/shredder_stage_1.png'),
  2: require('../assets/avatars/shredder_stage_2.png'),
  3: require('../assets/avatars/shredder_stage_3.png'),
  4: require('../assets/avatars/shredder_stage_4.png'),
};

export function shredderImage(stage: number): ImageSourcePropType {
  return SHREDDER_ASSETS[stage] ?? SHREDDER_ASSETS[1];
}
