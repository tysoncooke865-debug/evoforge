import type { ImageSourcePropType } from 'react-native';

import type { MuscleId } from './types';

/**
 * MUSCLE MASKS (Tyson's Krita artwork, 2026-07-15) — the hand-drawn front
 * overlays, extracted layer-by-layer from `silhouette front mask.kra` by
 * tools/extract_muscle_masks.py (decode proven pixel-identical against the
 * file's own merged image). THE .KRA IS THE SOURCE OF TRUTH: never redraw or
 * approximate these; re-run the tool when the artwork changes.
 *
 * The bundled `-lit` variants are the same pixels with the white fill
 * pre-tinted neon cyan and the black linework untouched (RN tintColor would
 * recolour the linework too). The exact-as-drawn masks live next to them in
 * assets/muscle-masks/front/ for re-tinting.
 *
 * Strictly the muscles Tyson has DRAWN — the type grows with the artwork,
 * never ahead of it.
 */
export type FrontMuscleId = 'chest' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'traps' | 'abs';

export const FRONT_MUSCLE_MASKS: Readonly<Record<FrontMuscleId, ImageSourcePropType>> = {
  chest: require('../../../assets/muscle-masks/front/lit/front-chest-lit.png'),
  shoulders: require('../../../assets/muscle-masks/front/lit/front-shoulders-lit.png'),
  biceps: require('../../../assets/muscle-masks/front/lit/front-biceps-lit.png'),
  triceps: require('../../../assets/muscle-masks/front/lit/front-triceps-lit.png'),
  forearms: require('../../../assets/muscle-masks/front/lit/front-forearms-lit.png'),
  traps: require('../../../assets/muscle-masks/front/lit/front-traps-lit.png'),
  abs: require('../../../assets/muscle-masks/front/lit/front-abs-lit.png'),
};

export function frontMaskFor(muscle: MuscleId): ImageSourcePropType | null {
  return (FRONT_MUSCLE_MASKS as Partial<Record<MuscleId, ImageSourcePropType>>)[muscle] ?? null;
}
