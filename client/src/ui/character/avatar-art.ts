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

/**
 * THE FIRST ANIMATED AVATAR (Tyson, 2026-07-16): the Mass Monster
 * 8-direction rotation GIF (92×92, 8 frames @ 200ms) — for the MASS LINE
 * ONLY. Every other branch keeps its static art until its own sprite set
 * lands (Tyson's correction, same day: a shared default replaced his
 * Aesthetic stage-3 character with the wrong body — never substitute one
 * class's art for another's). Add per-branch gifs to the map; nothing
 * else changes. The full move set (walk/run/jab/cross) sits beside it in
 * assets/sprites/mass-monster for the battle layer.
 */
/** Mass Monster stages 1-4 (Tyson's redesign pack, 2026-07-16, 148x148):
 *  per-stage rotations like the aesthetic line; the old single-stage gif
 *  is retired. */
const MASS_ROTATIONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/mass-monster/rotations-stage1.gif'),
  2: require('../../assets/sprites/mass-monster/rotations-stage2.gif'),
  3: require('../../assets/sprites/mass-monster/rotations-stage3.gif'),
  4: require('../../assets/sprites/mass-monster/rotations-stage4.gif'),
};

/** THE TITAN LINE, stages 1-4 (Titan_L4.zip, Tyson, 2026-07-16 —
 *  136×136, cyberpunk Viking): Titan no longer borrows the Mass
 *  Monster's body. Rotations only so far — the COMPANION keeps the
 *  mass move set until Titan's own animations land. */
const TITAN_ROTATIONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/titan/rotations-stage1.gif'),
  2: require('../../assets/sprites/titan/rotations-stage2.gif'),
  3: require('../../assets/sprites/titan/rotations-stage3.gif'),
  4: require('../../assets/sprites/titan/rotations-stage4.gif'),
};
const TITAN_STILLS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/titan/still-stage1.png'),
  2: require('../../assets/sprites/titan/still-stage2.png'),
  3: require('../../assets/sprites/titan/still-stage3.png'),
  4: require('../../assets/sprites/titan/still-stage4.png'),
};

/** THE SHREDDER line, stages 1-4 (Shredder_L4.zip, Tyson, 2026-07-16 —
 *  108×108, the redemption arc: hooded start → dual-blade shredded;
 *  pad 25-27%, within the constant's range). Stages ride BODY FAT as
 *  ever — only the ART is new. */
const SHREDDER_ROTATIONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/shredder/rotations-stage1.gif'),
  2: require('../../assets/sprites/shredder/rotations-stage2.gif'),
  3: require('../../assets/sprites/shredder/rotations-stage3.gif'),
  4: require('../../assets/sprites/shredder/rotations-stage4.gif'),
};
const SHREDDER_STILLS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/shredder/still-stage1.png'),
  2: require('../../assets/sprites/shredder/still-stage2.png'),
  3: require('../../assets/sprites/shredder/still-stage3.png'),
  4: require('../../assets/sprites/shredder/still-stage4.png'),
};

/** THE CARDIO MACHINE line, stages 1-4 (Enduro_L4.zip, Tyson,
 *  2026-07-16 — 120×120, blue-flame runner; L4's frames were shifted up
 *  11px at build so its feet match the measured ~24% pad). Rotations
 *  only — the companion keeps the Cyber Athlete move set. */
const CARDIO_ROTATIONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/cardio/rotations-stage1.gif'),
  2: require('../../assets/sprites/cardio/rotations-stage2.gif'),
  3: require('../../assets/sprites/cardio/rotations-stage3.gif'),
  4: require('../../assets/sprites/cardio/rotations-stage4.gif'),
};
const CARDIO_STILLS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/cardio/still-stage1.png'),
  2: require('../../assets/sprites/cardio/still-stage2.png'),
  3: require('../../assets/sprites/cardio/still-stage3.png'),
  4: require('../../assets/sprites/cardio/still-stage4.png'),
};

/** The Cyber Athlete line, stages 1–4 (Tyson, 2026-07-16 — 124×124,
 *  8 frames @ 200ms): the aesthetic HOME avatar rotates per stage. */
const AESTHETIC_ROTATIONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/aesthetic/rotations-stage1.gif'),
  2: require('../../assets/sprites/aesthetic/rotations-stage2.gif'),
  3: require('../../assets/sprites/aesthetic/rotations-stage3.gif'),
  4: require('../../assets/sprites/aesthetic/rotations-stage4.gif'),
};

/**
 * The animated rotation for a form, or undefined when none exists.
 * MALE ONLY for now — every delivered sprite is the male body, and the
 * standing rule (Tyson's correction, 2026-07-16) is NEVER substitute one
 * body's art for another's: female athletes keep their own static art
 * (or silhouettes) until female sprite sets land.
 */
export function animatedAvatar(
  branch: BranchV2,
  stage: number,
  sex: Sex
): ImageSourcePropType | undefined {
  if (sex !== 'male') return undefined;
  const s = Math.max(1, Math.min(4, Math.trunc(stage)));
  if (branch === 'titan') return TITAN_ROTATIONS[s];
  if (branch === 'mass') return MASS_ROTATIONS[s];
  if (branch === 'cardio') return CARDIO_ROTATIONS[s];
  if (branch === 'shredder') return SHREDDER_ROTATIONS[s];
  if (branch === 'aesthetic') return AESTHETIC_ROTATIONS[s];
  return undefined;
}

/** The FROZEN pose of each rotation (the south frame, SAME canvas as the
 *  gif so the layout math aligns). Rendered when the sprite exists but
 *  motion is gated (unfocused tab, reduced motion, perf mode) — the OLD
 *  painted art must never flash where a sprite set has replaced it
 *  (Tyson, 2026-07-16: the PNG flashed for a second on hero taps). */
const AESTHETIC_STILLS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/aesthetic/still-stage1.png'),
  2: require('../../assets/sprites/aesthetic/still-stage2.png'),
  3: require('../../assets/sprites/aesthetic/still-stage3.png'),
  4: require('../../assets/sprites/aesthetic/still-stage4.png'),
};
const MASS_STILLS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/sprites/mass-monster/still-stage1.png'),
  2: require('../../assets/sprites/mass-monster/still-stage2.png'),
  3: require('../../assets/sprites/mass-monster/still-stage3.png'),
  4: require('../../assets/sprites/mass-monster/still-stage4.png'),
};

export function stillAvatar(
  branch: BranchV2,
  stage: number,
  sex: Sex
): ImageSourcePropType | undefined {
  if (sex !== 'male') return undefined;
  const s = Math.max(1, Math.min(4, Math.trunc(stage)));
  if (branch === 'titan') return TITAN_STILLS[s];
  if (branch === 'mass') return MASS_STILLS[s];
  if (branch === 'cardio') return CARDIO_STILLS[s];
  if (branch === 'shredder') return SHREDDER_STILLS[s];
  if (branch === 'aesthetic') return AESTHETIC_STILLS[s];
  return undefined;
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
    // The Shredder pack's still replaces the old painted set (which has
    // BAKED BACKGROUNDS and could never silhouette or stage cleanly).
    return { source: SHREDDER_STILLS[Math.max(1, Math.min(4, Math.trunc(stage)))], hasArt: true };
  }
  if (branch === 'titan') {
    // Real art since the Titan pack: the still stands in as the "painted"
    // source so nothing silhouettes a form that exists.
    return { source: TITAN_STILLS[Math.max(1, Math.min(4, Math.trunc(stage)))], hasArt: true };
  }
  if (branch === 'cardio') {
    // Same for the Enduro pack — every male line has real art now.
    return { source: CARDIO_STILLS[Math.max(1, Math.min(4, Math.trunc(stage)))], hasArt: true };
  }
  return { source: avatarImage(branch, stage), hasArt: true };
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
