import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import type { SkinId } from '@/domain/customise';
import { animatedAvatar, avatarArtV2, stillAvatar, type Sex } from '@/ui/character/avatar-art';
import { skinnedAnimated, skinnedFemalePainted, skinnedStill } from '@/ui/character/avatar-skins';

/**
 * One skin-aware art resolver for every customise surface (roster
 * portraits, stage cards, preview). Falls back through: recoloured
 * sprite → base sprite → painted art — never substituting bodies, only
 * palettes.
 */
export interface FormArt {
  animated?: ImageSourcePropType;
  still?: ImageSourcePropType;
  painted: ImageSourcePropType;
  hasArt: boolean;
}

export function formArt(branch: BranchV2, stage: number, sex: Sex, skin: SkinId): FormArt {
  const base = avatarArtV2(branch, stage, sex);
  return {
    animated: skinnedAnimated(branch, stage, sex, skin) ?? animatedAvatar(branch, stage, sex),
    still: skinnedStill(branch, stage, sex, skin) ?? stillAvatar(branch, stage, sex),
    painted: skinnedFemalePainted(branch, stage, sex, skin) ?? base.source,
    hasArt: base.hasArt,
  };
}
