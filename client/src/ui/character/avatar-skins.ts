import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import { companionLine } from '@/domain/branches-v2';
import type { SkinId } from '@/domain/customise';

import type { Sex } from './avatar-art';

/**
 * SKINS (Tyson, 2026-07-16): palette-swap recolours of every delivered art
 * set — red/green/yellow/orange/white/black luminance duotones generated
 * from the base sprites (scratchpad gen_skins.py; re-run it when a base
 * set changes and these are regenerated in place). 'standard' and any
 * branch without a recoloured set resolve to undefined and the caller
 * falls back to the base art — the skin system can never substitute a
 * missing body.
 *
 * GENERATED require tables — regenerate rather than hand-edit.
 */

const AESTHETIC_SKIN_GIFS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/aesthetic-red-stage1.gif'),
  'red-2': require('../../assets/sprites/skins/aesthetic-red-stage2.gif'),
  'red-3': require('../../assets/sprites/skins/aesthetic-red-stage3.gif'),
  'red-4': require('../../assets/sprites/skins/aesthetic-red-stage4.gif'),
  'green-1': require('../../assets/sprites/skins/aesthetic-green-stage1.gif'),
  'green-2': require('../../assets/sprites/skins/aesthetic-green-stage2.gif'),
  'green-3': require('../../assets/sprites/skins/aesthetic-green-stage3.gif'),
  'green-4': require('../../assets/sprites/skins/aesthetic-green-stage4.gif'),
  'yellow-1': require('../../assets/sprites/skins/aesthetic-yellow-stage1.gif'),
  'yellow-2': require('../../assets/sprites/skins/aesthetic-yellow-stage2.gif'),
  'yellow-3': require('../../assets/sprites/skins/aesthetic-yellow-stage3.gif'),
  'yellow-4': require('../../assets/sprites/skins/aesthetic-yellow-stage4.gif'),
  'orange-1': require('../../assets/sprites/skins/aesthetic-orange-stage1.gif'),
  'orange-2': require('../../assets/sprites/skins/aesthetic-orange-stage2.gif'),
  'orange-3': require('../../assets/sprites/skins/aesthetic-orange-stage3.gif'),
  'orange-4': require('../../assets/sprites/skins/aesthetic-orange-stage4.gif'),
  'white-1': require('../../assets/sprites/skins/aesthetic-white-stage1.gif'),
  'white-2': require('../../assets/sprites/skins/aesthetic-white-stage2.gif'),
  'white-3': require('../../assets/sprites/skins/aesthetic-white-stage3.gif'),
  'white-4': require('../../assets/sprites/skins/aesthetic-white-stage4.gif'),
  'black-1': require('../../assets/sprites/skins/aesthetic-black-stage1.gif'),
  'black-2': require('../../assets/sprites/skins/aesthetic-black-stage2.gif'),
  'black-3': require('../../assets/sprites/skins/aesthetic-black-stage3.gif'),
  'black-4': require('../../assets/sprites/skins/aesthetic-black-stage4.gif'),
};

const AESTHETIC_SKIN_STILLS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/aesthetic-red-still-stage1.png'),
  'red-2': require('../../assets/sprites/skins/aesthetic-red-still-stage2.png'),
  'red-3': require('../../assets/sprites/skins/aesthetic-red-still-stage3.png'),
  'red-4': require('../../assets/sprites/skins/aesthetic-red-still-stage4.png'),
  'green-1': require('../../assets/sprites/skins/aesthetic-green-still-stage1.png'),
  'green-2': require('../../assets/sprites/skins/aesthetic-green-still-stage2.png'),
  'green-3': require('../../assets/sprites/skins/aesthetic-green-still-stage3.png'),
  'green-4': require('../../assets/sprites/skins/aesthetic-green-still-stage4.png'),
  'yellow-1': require('../../assets/sprites/skins/aesthetic-yellow-still-stage1.png'),
  'yellow-2': require('../../assets/sprites/skins/aesthetic-yellow-still-stage2.png'),
  'yellow-3': require('../../assets/sprites/skins/aesthetic-yellow-still-stage3.png'),
  'yellow-4': require('../../assets/sprites/skins/aesthetic-yellow-still-stage4.png'),
  'orange-1': require('../../assets/sprites/skins/aesthetic-orange-still-stage1.png'),
  'orange-2': require('../../assets/sprites/skins/aesthetic-orange-still-stage2.png'),
  'orange-3': require('../../assets/sprites/skins/aesthetic-orange-still-stage3.png'),
  'orange-4': require('../../assets/sprites/skins/aesthetic-orange-still-stage4.png'),
  'white-1': require('../../assets/sprites/skins/aesthetic-white-still-stage1.png'),
  'white-2': require('../../assets/sprites/skins/aesthetic-white-still-stage2.png'),
  'white-3': require('../../assets/sprites/skins/aesthetic-white-still-stage3.png'),
  'white-4': require('../../assets/sprites/skins/aesthetic-white-still-stage4.png'),
  'black-1': require('../../assets/sprites/skins/aesthetic-black-still-stage1.png'),
  'black-2': require('../../assets/sprites/skins/aesthetic-black-still-stage2.png'),
  'black-3': require('../../assets/sprites/skins/aesthetic-black-still-stage3.png'),
  'black-4': require('../../assets/sprites/skins/aesthetic-black-still-stage4.png'),
};

const MASS_SKIN_GIFS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/mass-red-stage1.gif'),
  'red-2': require('../../assets/sprites/skins/mass-red-stage2.gif'),
  'red-3': require('../../assets/sprites/skins/mass-red-stage3.gif'),
  'red-4': require('../../assets/sprites/skins/mass-red-stage4.gif'),
  'green-1': require('../../assets/sprites/skins/mass-green-stage1.gif'),
  'green-2': require('../../assets/sprites/skins/mass-green-stage2.gif'),
  'green-3': require('../../assets/sprites/skins/mass-green-stage3.gif'),
  'green-4': require('../../assets/sprites/skins/mass-green-stage4.gif'),
  'yellow-1': require('../../assets/sprites/skins/mass-yellow-stage1.gif'),
  'yellow-2': require('../../assets/sprites/skins/mass-yellow-stage2.gif'),
  'yellow-3': require('../../assets/sprites/skins/mass-yellow-stage3.gif'),
  'yellow-4': require('../../assets/sprites/skins/mass-yellow-stage4.gif'),
  'orange-1': require('../../assets/sprites/skins/mass-orange-stage1.gif'),
  'orange-2': require('../../assets/sprites/skins/mass-orange-stage2.gif'),
  'orange-3': require('../../assets/sprites/skins/mass-orange-stage3.gif'),
  'orange-4': require('../../assets/sprites/skins/mass-orange-stage4.gif'),
  'white-1': require('../../assets/sprites/skins/mass-white-stage1.gif'),
  'white-2': require('../../assets/sprites/skins/mass-white-stage2.gif'),
  'white-3': require('../../assets/sprites/skins/mass-white-stage3.gif'),
  'white-4': require('../../assets/sprites/skins/mass-white-stage4.gif'),
  'black-1': require('../../assets/sprites/skins/mass-black-stage1.gif'),
  'black-2': require('../../assets/sprites/skins/mass-black-stage2.gif'),
  'black-3': require('../../assets/sprites/skins/mass-black-stage3.gif'),
  'black-4': require('../../assets/sprites/skins/mass-black-stage4.gif'),
};

const MASS_SKIN_STILLS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/mass-red-still-stage1.png'),
  'red-2': require('../../assets/sprites/skins/mass-red-still-stage2.png'),
  'red-3': require('../../assets/sprites/skins/mass-red-still-stage3.png'),
  'red-4': require('../../assets/sprites/skins/mass-red-still-stage4.png'),
  'green-1': require('../../assets/sprites/skins/mass-green-still-stage1.png'),
  'green-2': require('../../assets/sprites/skins/mass-green-still-stage2.png'),
  'green-3': require('../../assets/sprites/skins/mass-green-still-stage3.png'),
  'green-4': require('../../assets/sprites/skins/mass-green-still-stage4.png'),
  'yellow-1': require('../../assets/sprites/skins/mass-yellow-still-stage1.png'),
  'yellow-2': require('../../assets/sprites/skins/mass-yellow-still-stage2.png'),
  'yellow-3': require('../../assets/sprites/skins/mass-yellow-still-stage3.png'),
  'yellow-4': require('../../assets/sprites/skins/mass-yellow-still-stage4.png'),
  'orange-1': require('../../assets/sprites/skins/mass-orange-still-stage1.png'),
  'orange-2': require('../../assets/sprites/skins/mass-orange-still-stage2.png'),
  'orange-3': require('../../assets/sprites/skins/mass-orange-still-stage3.png'),
  'orange-4': require('../../assets/sprites/skins/mass-orange-still-stage4.png'),
  'white-1': require('../../assets/sprites/skins/mass-white-still-stage1.png'),
  'white-2': require('../../assets/sprites/skins/mass-white-still-stage2.png'),
  'white-3': require('../../assets/sprites/skins/mass-white-still-stage3.png'),
  'white-4': require('../../assets/sprites/skins/mass-white-still-stage4.png'),
  'black-1': require('../../assets/sprites/skins/mass-black-still-stage1.png'),
  'black-2': require('../../assets/sprites/skins/mass-black-still-stage2.png'),
  'black-3': require('../../assets/sprites/skins/mass-black-still-stage3.png'),
  'black-4': require('../../assets/sprites/skins/mass-black-still-stage4.png'),
};

const FEMALE_AESTHETIC_SKINS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/avatars/skins/female-aesthetic-red-stage1.png'),
  'red-2': require('../../assets/avatars/skins/female-aesthetic-red-stage2.png'),
  'red-3': require('../../assets/avatars/skins/female-aesthetic-red-stage3.png'),
  'red-4': require('../../assets/avatars/skins/female-aesthetic-red-stage4.png'),
  'green-1': require('../../assets/avatars/skins/female-aesthetic-green-stage1.png'),
  'green-2': require('../../assets/avatars/skins/female-aesthetic-green-stage2.png'),
  'green-3': require('../../assets/avatars/skins/female-aesthetic-green-stage3.png'),
  'green-4': require('../../assets/avatars/skins/female-aesthetic-green-stage4.png'),
  'yellow-1': require('../../assets/avatars/skins/female-aesthetic-yellow-stage1.png'),
  'yellow-2': require('../../assets/avatars/skins/female-aesthetic-yellow-stage2.png'),
  'yellow-3': require('../../assets/avatars/skins/female-aesthetic-yellow-stage3.png'),
  'yellow-4': require('../../assets/avatars/skins/female-aesthetic-yellow-stage4.png'),
  'orange-1': require('../../assets/avatars/skins/female-aesthetic-orange-stage1.png'),
  'orange-2': require('../../assets/avatars/skins/female-aesthetic-orange-stage2.png'),
  'orange-3': require('../../assets/avatars/skins/female-aesthetic-orange-stage3.png'),
  'orange-4': require('../../assets/avatars/skins/female-aesthetic-orange-stage4.png'),
  'white-1': require('../../assets/avatars/skins/female-aesthetic-white-stage1.png'),
  'white-2': require('../../assets/avatars/skins/female-aesthetic-white-stage2.png'),
  'white-3': require('../../assets/avatars/skins/female-aesthetic-white-stage3.png'),
  'white-4': require('../../assets/avatars/skins/female-aesthetic-white-stage4.png'),
  'black-1': require('../../assets/avatars/skins/female-aesthetic-black-stage1.png'),
  'black-2': require('../../assets/avatars/skins/female-aesthetic-black-stage2.png'),
  'black-3': require('../../assets/avatars/skins/female-aesthetic-black-stage3.png'),
  'black-4': require('../../assets/avatars/skins/female-aesthetic-black-stage4.png'),
};

function key(skin: SkinId, stage: number): string {
  return `${skin}-${Math.max(1, Math.min(4, Math.trunc(stage)))}`;
}

/** The recoloured rotation GIF, or undefined → caller uses the base art. */
export function skinnedAnimated(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  const line = companionLine(branch);
  if (branch === 'hybrid' || branch === 'cardio') return undefined;
  return (line === 'mass' ? MASS_SKIN_GIFS : AESTHETIC_SKIN_GIFS)[key(skin, stage)];
}

/** The recoloured frozen pose (same canvas as the gif). */
export function skinnedStill(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  const line = companionLine(branch);
  if (branch === 'hybrid' || branch === 'cardio') return undefined;
  return (line === 'mass' ? MASS_SKIN_STILLS : AESTHETIC_SKIN_STILLS)[key(skin, stage)];
}

/** The recoloured female painted art (aesthetic line only — the only
 *  delivered female set). */
export function skinnedFemalePainted(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'female' || branch !== 'aesthetic') return undefined;
  return FEMALE_AESTHETIC_SKINS[key(skin, stage)];
}
