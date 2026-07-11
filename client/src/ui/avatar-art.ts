import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';

import { avatarImage } from './avatar-images';

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
      return 'aesthetic';
  }
}

export function avatarArtV2(branch: BranchV2, stage: number, sex: Sex): AvatarArt {
  const coreBranch = branch === 'titan' || branch === 'cardio' ? null : branch;
  if (sex === 'male' && coreBranch) {
    return { source: avatarImage(coreBranch, stage), hasArt: true };
  }
  // Female forms and the two new classes: silhouette of the shape donor.
  return { source: avatarImage(shapeDonor(branch), stage), hasArt: false };
}
