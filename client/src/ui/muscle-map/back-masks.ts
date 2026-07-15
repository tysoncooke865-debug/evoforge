import type { ImageSourcePropType } from 'react-native';

import type { BackMuscleId, MuscleId } from '@/domain/muscle-map';

/**
 * The BACK-view Krita masks (Tyson, 2026-07-15): rear delts + rear triceps
 * so far, extracted by tools/extract_muscle_masks.py under its proof ladder
 * (this file's proof: the imported Background layer decoded pixel-identical
 * to the original silhouette PNG). Same rules as front-masks.ts — the .kra
 * is the source of truth, the id list lives in the domain (BACK_MASKED_IDS),
 * and this Record types against it so the two cannot drift.
 */
export type { BackMuscleId } from '@/domain/muscle-map';

export const BACK_MUSCLE_MASKS: Readonly<Record<BackMuscleId, ImageSourcePropType>> = {
  shoulders: require('../../../assets/muscle-masks/back/lit/back-shoulders-lit.png'),
  triceps: require('../../../assets/muscle-masks/back/lit/back-triceps-lit.png'),
  traps: require('../../../assets/muscle-masks/back/lit/back-traps-lit.png'),
  calves: require('../../../assets/muscle-masks/back/lit/back-calves-lit.png'),
  hamstrings: require('../../../assets/muscle-masks/back/lit/back-hamstrings-lit.png'),
  glutes: require('../../../assets/muscle-masks/back/lit/back-glutes-lit.png'),
  lowerBack: require('../../../assets/muscle-masks/back/lit/back-lowerBack-lit.png'),
  lats: require('../../../assets/muscle-masks/back/lit/back-lats-lit.png'),
  upperBack: require('../../../assets/muscle-masks/back/lit/back-upperBack-lit.png'),
};

export function backMaskFor(muscle: MuscleId): ImageSourcePropType | null {
  return (BACK_MUSCLE_MASKS as Partial<Record<MuscleId, ImageSourcePropType>>)[muscle] ?? null;
}
