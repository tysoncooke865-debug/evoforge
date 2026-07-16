import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
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
  'adam-1': require('../../assets/sprites/skins/aesthetic-adam-stage1.gif'),
  'adam-2': require('../../assets/sprites/skins/aesthetic-adam-stage2.gif'),
  'adam-3': require('../../assets/sprites/skins/aesthetic-adam-stage3.gif'),
  'adam-4': require('../../assets/sprites/skins/aesthetic-adam-stage4.gif'),
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
  'adam-1': require('../../assets/sprites/skins/aesthetic-adam-still-stage1.png'),
  'adam-2': require('../../assets/sprites/skins/aesthetic-adam-still-stage2.png'),
  'adam-3': require('../../assets/sprites/skins/aesthetic-adam-still-stage3.png'),
  'adam-4': require('../../assets/sprites/skins/aesthetic-adam-still-stage4.png'),
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
  'adam-1': require('../../assets/sprites/skins/mass-adam-stage1.gif'),
  'adam-2': require('../../assets/sprites/skins/mass-adam-stage2.gif'),
  'adam-3': require('../../assets/sprites/skins/mass-adam-stage3.gif'),
  'adam-4': require('../../assets/sprites/skins/mass-adam-stage4.gif'),
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
  'adam-1': require('../../assets/sprites/skins/mass-adam-still-stage1.png'),
  'adam-2': require('../../assets/sprites/skins/mass-adam-still-stage2.png'),
  'adam-3': require('../../assets/sprites/skins/mass-adam-still-stage3.png'),
  'adam-4': require('../../assets/sprites/skins/mass-adam-still-stage4.png'),
};

const TITAN_SKIN_GIFS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/titan-red-stage1.gif'),
  'red-2': require('../../assets/sprites/skins/titan-red-stage2.gif'),
  'red-3': require('../../assets/sprites/skins/titan-red-stage3.gif'),
  'red-4': require('../../assets/sprites/skins/titan-red-stage4.gif'),
  'green-1': require('../../assets/sprites/skins/titan-green-stage1.gif'),
  'green-2': require('../../assets/sprites/skins/titan-green-stage2.gif'),
  'green-3': require('../../assets/sprites/skins/titan-green-stage3.gif'),
  'green-4': require('../../assets/sprites/skins/titan-green-stage4.gif'),
  'yellow-1': require('../../assets/sprites/skins/titan-yellow-stage1.gif'),
  'yellow-2': require('../../assets/sprites/skins/titan-yellow-stage2.gif'),
  'yellow-3': require('../../assets/sprites/skins/titan-yellow-stage3.gif'),
  'yellow-4': require('../../assets/sprites/skins/titan-yellow-stage4.gif'),
  'orange-1': require('../../assets/sprites/skins/titan-orange-stage1.gif'),
  'orange-2': require('../../assets/sprites/skins/titan-orange-stage2.gif'),
  'orange-3': require('../../assets/sprites/skins/titan-orange-stage3.gif'),
  'orange-4': require('../../assets/sprites/skins/titan-orange-stage4.gif'),
  'white-1': require('../../assets/sprites/skins/titan-white-stage1.gif'),
  'white-2': require('../../assets/sprites/skins/titan-white-stage2.gif'),
  'white-3': require('../../assets/sprites/skins/titan-white-stage3.gif'),
  'white-4': require('../../assets/sprites/skins/titan-white-stage4.gif'),
  'black-1': require('../../assets/sprites/skins/titan-black-stage1.gif'),
  'black-2': require('../../assets/sprites/skins/titan-black-stage2.gif'),
  'black-3': require('../../assets/sprites/skins/titan-black-stage3.gif'),
  'black-4': require('../../assets/sprites/skins/titan-black-stage4.gif'),
  'adam-1': require('../../assets/sprites/skins/titan-adam-stage1.gif'),
  'adam-2': require('../../assets/sprites/skins/titan-adam-stage2.gif'),
  'adam-3': require('../../assets/sprites/skins/titan-adam-stage3.gif'),
  'adam-4': require('../../assets/sprites/skins/titan-adam-stage4.gif'),
};

const TITAN_SKIN_STILLS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/titan-red-still-stage1.png'),
  'red-2': require('../../assets/sprites/skins/titan-red-still-stage2.png'),
  'red-3': require('../../assets/sprites/skins/titan-red-still-stage3.png'),
  'red-4': require('../../assets/sprites/skins/titan-red-still-stage4.png'),
  'green-1': require('../../assets/sprites/skins/titan-green-still-stage1.png'),
  'green-2': require('../../assets/sprites/skins/titan-green-still-stage2.png'),
  'green-3': require('../../assets/sprites/skins/titan-green-still-stage3.png'),
  'green-4': require('../../assets/sprites/skins/titan-green-still-stage4.png'),
  'yellow-1': require('../../assets/sprites/skins/titan-yellow-still-stage1.png'),
  'yellow-2': require('../../assets/sprites/skins/titan-yellow-still-stage2.png'),
  'yellow-3': require('../../assets/sprites/skins/titan-yellow-still-stage3.png'),
  'yellow-4': require('../../assets/sprites/skins/titan-yellow-still-stage4.png'),
  'orange-1': require('../../assets/sprites/skins/titan-orange-still-stage1.png'),
  'orange-2': require('../../assets/sprites/skins/titan-orange-still-stage2.png'),
  'orange-3': require('../../assets/sprites/skins/titan-orange-still-stage3.png'),
  'orange-4': require('../../assets/sprites/skins/titan-orange-still-stage4.png'),
  'white-1': require('../../assets/sprites/skins/titan-white-still-stage1.png'),
  'white-2': require('../../assets/sprites/skins/titan-white-still-stage2.png'),
  'white-3': require('../../assets/sprites/skins/titan-white-still-stage3.png'),
  'white-4': require('../../assets/sprites/skins/titan-white-still-stage4.png'),
  'black-1': require('../../assets/sprites/skins/titan-black-still-stage1.png'),
  'black-2': require('../../assets/sprites/skins/titan-black-still-stage2.png'),
  'black-3': require('../../assets/sprites/skins/titan-black-still-stage3.png'),
  'black-4': require('../../assets/sprites/skins/titan-black-still-stage4.png'),
  'adam-1': require('../../assets/sprites/skins/titan-adam-still-stage1.png'),
  'adam-2': require('../../assets/sprites/skins/titan-adam-still-stage2.png'),
  'adam-3': require('../../assets/sprites/skins/titan-adam-still-stage3.png'),
  'adam-4': require('../../assets/sprites/skins/titan-adam-still-stage4.png'),
};

const CARDIO_SKIN_GIFS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/cardio-red-stage1.gif'),
  'red-2': require('../../assets/sprites/skins/cardio-red-stage2.gif'),
  'red-3': require('../../assets/sprites/skins/cardio-red-stage3.gif'),
  'red-4': require('../../assets/sprites/skins/cardio-red-stage4.gif'),
  'green-1': require('../../assets/sprites/skins/cardio-green-stage1.gif'),
  'green-2': require('../../assets/sprites/skins/cardio-green-stage2.gif'),
  'green-3': require('../../assets/sprites/skins/cardio-green-stage3.gif'),
  'green-4': require('../../assets/sprites/skins/cardio-green-stage4.gif'),
  'yellow-1': require('../../assets/sprites/skins/cardio-yellow-stage1.gif'),
  'yellow-2': require('../../assets/sprites/skins/cardio-yellow-stage2.gif'),
  'yellow-3': require('../../assets/sprites/skins/cardio-yellow-stage3.gif'),
  'yellow-4': require('../../assets/sprites/skins/cardio-yellow-stage4.gif'),
  'orange-1': require('../../assets/sprites/skins/cardio-orange-stage1.gif'),
  'orange-2': require('../../assets/sprites/skins/cardio-orange-stage2.gif'),
  'orange-3': require('../../assets/sprites/skins/cardio-orange-stage3.gif'),
  'orange-4': require('../../assets/sprites/skins/cardio-orange-stage4.gif'),
  'white-1': require('../../assets/sprites/skins/cardio-white-stage1.gif'),
  'white-2': require('../../assets/sprites/skins/cardio-white-stage2.gif'),
  'white-3': require('../../assets/sprites/skins/cardio-white-stage3.gif'),
  'white-4': require('../../assets/sprites/skins/cardio-white-stage4.gif'),
  'black-1': require('../../assets/sprites/skins/cardio-black-stage1.gif'),
  'black-2': require('../../assets/sprites/skins/cardio-black-stage2.gif'),
  'black-3': require('../../assets/sprites/skins/cardio-black-stage3.gif'),
  'black-4': require('../../assets/sprites/skins/cardio-black-stage4.gif'),
  'adam-1': require('../../assets/sprites/skins/cardio-adam-stage1.gif'),
  'adam-2': require('../../assets/sprites/skins/cardio-adam-stage2.gif'),
  'adam-3': require('../../assets/sprites/skins/cardio-adam-stage3.gif'),
  'adam-4': require('../../assets/sprites/skins/cardio-adam-stage4.gif'),
};

const CARDIO_SKIN_STILLS: Record<string, ImageSourcePropType> = {
  'red-1': require('../../assets/sprites/skins/cardio-red-still-stage1.png'),
  'red-2': require('../../assets/sprites/skins/cardio-red-still-stage2.png'),
  'red-3': require('../../assets/sprites/skins/cardio-red-still-stage3.png'),
  'red-4': require('../../assets/sprites/skins/cardio-red-still-stage4.png'),
  'green-1': require('../../assets/sprites/skins/cardio-green-still-stage1.png'),
  'green-2': require('../../assets/sprites/skins/cardio-green-still-stage2.png'),
  'green-3': require('../../assets/sprites/skins/cardio-green-still-stage3.png'),
  'green-4': require('../../assets/sprites/skins/cardio-green-still-stage4.png'),
  'yellow-1': require('../../assets/sprites/skins/cardio-yellow-still-stage1.png'),
  'yellow-2': require('../../assets/sprites/skins/cardio-yellow-still-stage2.png'),
  'yellow-3': require('../../assets/sprites/skins/cardio-yellow-still-stage3.png'),
  'yellow-4': require('../../assets/sprites/skins/cardio-yellow-still-stage4.png'),
  'orange-1': require('../../assets/sprites/skins/cardio-orange-still-stage1.png'),
  'orange-2': require('../../assets/sprites/skins/cardio-orange-still-stage2.png'),
  'orange-3': require('../../assets/sprites/skins/cardio-orange-still-stage3.png'),
  'orange-4': require('../../assets/sprites/skins/cardio-orange-still-stage4.png'),
  'white-1': require('../../assets/sprites/skins/cardio-white-still-stage1.png'),
  'white-2': require('../../assets/sprites/skins/cardio-white-still-stage2.png'),
  'white-3': require('../../assets/sprites/skins/cardio-white-still-stage3.png'),
  'white-4': require('../../assets/sprites/skins/cardio-white-still-stage4.png'),
  'black-1': require('../../assets/sprites/skins/cardio-black-still-stage1.png'),
  'black-2': require('../../assets/sprites/skins/cardio-black-still-stage2.png'),
  'black-3': require('../../assets/sprites/skins/cardio-black-still-stage3.png'),
  'black-4': require('../../assets/sprites/skins/cardio-black-still-stage4.png'),
  'adam-1': require('../../assets/sprites/skins/cardio-adam-still-stage1.png'),
  'adam-2': require('../../assets/sprites/skins/cardio-adam-still-stage2.png'),
  'adam-3': require('../../assets/sprites/skins/cardio-adam-still-stage3.png'),
  'adam-4': require('../../assets/sprites/skins/cardio-adam-still-stage4.png'),
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
  'adam-1': require('../../assets/avatars/skins/female-aesthetic-adam-stage1.png'),
  'adam-2': require('../../assets/avatars/skins/female-aesthetic-adam-stage2.png'),
  'adam-3': require('../../assets/avatars/skins/female-aesthetic-adam-stage3.png'),
  'adam-4': require('../../assets/avatars/skins/female-aesthetic-adam-stage4.png'),
};

function key(skin: SkinId, stage: number): string {
  return `${skin}-${Math.max(1, Math.min(4, Math.trunc(stage)))}`;
}

/** Which recolour tables a branch draws from — EXPLICIT per line now that
 *  Titan has its own body (companionLine still maps titan->mass for the
 *  MOVE SET; skins must not follow that borrow). */
function skinTables(branch: BranchV2): { gifs: Record<string, ImageSourcePropType>; stills: Record<string, ImageSourcePropType> } | null {
  if (branch === 'titan') return { gifs: TITAN_SKIN_GIFS, stills: TITAN_SKIN_STILLS };
  if (branch === 'cardio') return { gifs: CARDIO_SKIN_GIFS, stills: CARDIO_SKIN_STILLS };
  if (branch === 'mass') return { gifs: MASS_SKIN_GIFS, stills: MASS_SKIN_STILLS };
  if (branch === 'aesthetic' || branch === 'shredder') return { gifs: AESTHETIC_SKIN_GIFS, stills: AESTHETIC_SKIN_STILLS };
  return null;
}

/** The recoloured rotation GIF, or undefined → caller uses the base art. */
export function skinnedAnimated(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  return skinTables(branch)?.gifs[key(skin, stage)];
}

/** The recoloured frozen pose (same canvas as the gif). */
export function skinnedStill(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  return skinTables(branch)?.stills[key(skin, stage)];
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
