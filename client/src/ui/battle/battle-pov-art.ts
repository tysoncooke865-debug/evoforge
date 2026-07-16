import type { ImageSourcePropType } from 'react-native';

import type { SpriteBranch } from '@/domain/battle-rpg/types';

/**
 * BATTLE POV ART (Tyson, 2026-07-16) — the Pokémon-style camera. Extracted
 * from each line's 8-direction rotation (no new art): the PLAYER shows their
 * BACK (north-east frame, lower-left, facing up-right at the foe); the
 * OPPONENT shows their FRONT (south-west frame, upper-right, facing
 * down-left). GENERATED require tables — regenerate, don't hand-edit.
 */

const BACK: Record<string, ImageSourcePropType> = {
  'aesthetic-1': require('../../assets/sprites/battle-pov/aesthetic-back-stage1.png'),
  'aesthetic-2': require('../../assets/sprites/battle-pov/aesthetic-back-stage2.png'),
  'aesthetic-3': require('../../assets/sprites/battle-pov/aesthetic-back-stage3.png'),
  'aesthetic-4': require('../../assets/sprites/battle-pov/aesthetic-back-stage4.png'),
  'titan-1': require('../../assets/sprites/battle-pov/titan-back-stage1.png'),
  'titan-2': require('../../assets/sprites/battle-pov/titan-back-stage2.png'),
  'titan-3': require('../../assets/sprites/battle-pov/titan-back-stage3.png'),
  'titan-4': require('../../assets/sprites/battle-pov/titan-back-stage4.png'),
  'cardio-1': require('../../assets/sprites/battle-pov/cardio-back-stage1.png'),
  'cardio-2': require('../../assets/sprites/battle-pov/cardio-back-stage2.png'),
  'cardio-3': require('../../assets/sprites/battle-pov/cardio-back-stage3.png'),
  'cardio-4': require('../../assets/sprites/battle-pov/cardio-back-stage4.png'),
  'shredder-1': require('../../assets/sprites/battle-pov/shredder-back-stage1.png'),
  'shredder-2': require('../../assets/sprites/battle-pov/shredder-back-stage2.png'),
  'shredder-3': require('../../assets/sprites/battle-pov/shredder-back-stage3.png'),
  'shredder-4': require('../../assets/sprites/battle-pov/shredder-back-stage4.png'),
};

const FRONT: Record<string, ImageSourcePropType> = {
  'aesthetic-1': require('../../assets/sprites/battle-pov/aesthetic-front-stage1.png'),
  'aesthetic-2': require('../../assets/sprites/battle-pov/aesthetic-front-stage2.png'),
  'aesthetic-3': require('../../assets/sprites/battle-pov/aesthetic-front-stage3.png'),
  'aesthetic-4': require('../../assets/sprites/battle-pov/aesthetic-front-stage4.png'),
  'titan-1': require('../../assets/sprites/battle-pov/titan-front-stage1.png'),
  'titan-2': require('../../assets/sprites/battle-pov/titan-front-stage2.png'),
  'titan-3': require('../../assets/sprites/battle-pov/titan-front-stage3.png'),
  'titan-4': require('../../assets/sprites/battle-pov/titan-front-stage4.png'),
  'cardio-1': require('../../assets/sprites/battle-pov/cardio-front-stage1.png'),
  'cardio-2': require('../../assets/sprites/battle-pov/cardio-front-stage2.png'),
  'cardio-3': require('../../assets/sprites/battle-pov/cardio-front-stage3.png'),
  'cardio-4': require('../../assets/sprites/battle-pov/cardio-front-stage4.png'),
  'shredder-1': require('../../assets/sprites/battle-pov/shredder-front-stage1.png'),
  'shredder-2': require('../../assets/sprites/battle-pov/shredder-front-stage2.png'),
  'shredder-3': require('../../assets/sprites/battle-pov/shredder-front-stage3.png'),
  'shredder-4': require('../../assets/sprites/battle-pov/shredder-front-stage4.png'),
};

function povLine(branch: SpriteBranch): 'aesthetic' | 'titan' | 'cardio' | 'shredder' {
  if (branch === 'titan' || branch === 'mass') return 'titan';
  if (branch === 'cardio' || branch === 'hybrid') return 'cardio';
  if (branch === 'shredder') return 'shredder';
  return 'aesthetic';
}

const key = (branch: SpriteBranch, stage: number) => `${povLine(branch)}-${Math.max(1, Math.min(4, Math.trunc(stage)))}`;

/** The battle sprite for a combatant: back for the player, front for the foe. */
export function battlePovArt(branch: SpriteBranch, stage: number, pov: 'back' | 'front'): ImageSourcePropType {
  return (pov === 'back' ? BACK : FRONT)[key(branch, stage)];
}
