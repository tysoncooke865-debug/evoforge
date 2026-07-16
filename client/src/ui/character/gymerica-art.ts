import type { ImageSourcePropType } from 'react-native';

import type { GymericaSkin } from '@/domain/customise';

/**
 * CAPTAIN GYMERICA (Tyson, 2026-07-16) — the premium purchasable hero
 * (Captain_Gymerica.zip, 168×168). Two stages (armoured → plate-shield)
 * and two looks: the navy/cyan standard and the red/white/blue "United
 * States of Aesthetics". Not a training class — an equipped OVERLAY, so
 * it lives outside avatar-art's branch maps. Rotations only for now; the
 * companion keeps its move set (Gymerica is a hero-stage avatar).
 */

type Look = GymericaSkin; // 'standard' | 'usa'

const ROTATIONS: Record<Look, Record<number, ImageSourcePropType>> = {
  standard: {
    1: require('../../assets/sprites/gymerica/rotations-stage1.gif'),
    2: require('../../assets/sprites/gymerica/rotations-stage2.gif'),
  },
  usa: {
    1: require('../../assets/sprites/gymerica/usa-rotations-stage1.gif'),
    2: require('../../assets/sprites/gymerica/usa-rotations-stage2.gif'),
  },
};

const STILLS: Record<Look, Record<number, ImageSourcePropType>> = {
  standard: {
    1: require('../../assets/sprites/gymerica/still-stage1.png'),
    2: require('../../assets/sprites/gymerica/still-stage2.png'),
  },
  usa: {
    1: require('../../assets/sprites/gymerica/usa-still-stage1.png'),
    2: require('../../assets/sprites/gymerica/usa-still-stage2.png'),
  },
};

const clampStage = (stage: number) => (Math.trunc(stage) >= 2 ? 2 : 1);

export function gymericaAnimated(stage: number, look: Look): ImageSourcePropType {
  return ROTATIONS[look][clampStage(stage)];
}

export function gymericaStill(stage: number, look: Look): ImageSourcePropType {
  return STILLS[look][clampStage(stage)];
}
