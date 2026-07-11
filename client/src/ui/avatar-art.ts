import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';

import { avatarImage, shredderImage } from './avatar-images';

/**
 * ART MAP V2 — five branches × two sexes. Real artwork exists today only for
 * the three original MALE branches; everything else renders as a SILHOUETTE
 * of the nearest existing form ("form not yet forged") until the art lands.
 * The needed-art list lives in PARITY.md; drop-in: add the require() here and
 * flip hasArt — nothing else changes.
 */

export type Sex = 'male' | 'female';

export interface AvatarArt {
  source: ImageSourcePropType;
  /** False = placeholder: render silhouetted, never as real art. */
  hasArt: boolean;
}

/** Which existing art a missing form borrows its SHAPE from. */
function shapeDonor(branch: BranchV2): 'aesthetic' | 'mass' | 'hybrid' {
  switch (branch) {
    case 'titan':
    case 'mass':
      return 'mass';
    case 'cardio':
    case 'hybrid':
      return 'hybrid';
    default:
      // shredder + aesthetic: the aesthetic line donates the shape (the
      // shredder art itself has baked backgrounds and cannot silhouette).
      return 'aesthetic';
  }
}

export function avatarArtV2(branch: BranchV2, stage: number, sex: Sex): AvatarArt {
  if (branch === 'shredder') {
    // Real art for males; female shredder awaits its own set.
    if (sex === 'male') return { source: shredderImage(stage), hasArt: true };
    return { source: avatarImage('aesthetic', Math.min(stage, 4)), hasArt: false };
  }
  const coreBranch = branch === 'titan' || branch === 'cardio' ? null : branch;
  if (sex === 'male' && coreBranch) {
    return { source: avatarImage(coreBranch, stage), hasArt: true };
  }
  // Female forms and the two new classes: silhouette of the shape donor.
  return { source: avatarImage(shapeDonor(branch), stage), hasArt: false };
}

/**
 * The Arena battle sprites: each athlete seen from behind, looking across
 * at the opponent (the Pokémon back-sprite convention) — the LEFT sprite
 * gazes right, the RIGHT sprite gazes left. Redrawn per side, never
 * mirrored (Tyson, 2026-07-12). Classes and sexes without a sprite fall
 * back to the front art (null here).
 */
export function battleBackArtV2(branch: BranchV2, sex: Sex, side: 'left' | 'right'): ImageSourcePropType | null {
  if (sex === 'male' && (branch === 'aesthetic' || branch === 'shredder')) {
    return side === 'left'
      ? require('../assets/avatars/battle_back_aesthetic_male.png')
      : require('../assets/avatars/battle_back_right_aesthetic_male.png');
  }
  return null;
}
