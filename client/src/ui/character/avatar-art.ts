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

/** The female Cyber Athlete line (2026-07-12): FRONT poses cropped from
 *  Tyson's female LV.1-4 sheets, exactly like the male aesthetic art. */
const FEMALE_AESTHETIC: Record<number, ImageSourcePropType> = {
  1: require('../../assets/avatars/aesthetic_front_female_stage_1.png'),
  2: require('../../assets/avatars/aesthetic_front_female_stage_2.png'),
  3: require('../../assets/avatars/aesthetic_front_female_stage_3.png'),
  4: require('../../assets/avatars/aesthetic_front_female_stage_4.png'),
};

function femaleAestheticImage(stage: number): ImageSourcePropType {
  return FEMALE_AESTHETIC[stage] ?? FEMALE_AESTHETIC[1];
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
  if (sex === 'female') {
    // Real female art exists for the aesthetic line (LV.1-4). Other female
    // forms silhouette the FEMALE shape when aesthetic donates (ponytail
    // outline, not a male one); mass/hybrid donors still await female art.
    if (branch === 'aesthetic') return { source: femaleAestheticImage(stage), hasArt: true };
    const donor = shapeDonor(branch);
    if (donor === 'aesthetic') {
      return { source: femaleAestheticImage(Math.min(stage, 4)), hasArt: false };
    }
    return { source: avatarImage(donor, stage), hasArt: false };
  }
  if (branch === 'shredder') {
    return { source: shredderImage(stage), hasArt: true };
  }
  const coreBranch = branch === 'titan' || branch === 'cardio' ? null : branch;
  if (coreBranch) {
    return { source: avatarImage(coreBranch, stage), hasArt: true };
  }
  // The two new classes: silhouette of the shape donor.
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
      ? require('../../assets/avatars/battle_back_aesthetic_male.png')
      : require('../../assets/avatars/battle_back_right_aesthetic_male.png');
  }
  return null;
}
