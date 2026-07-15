/**
 * MUSCLE MAP — component-side re-export of the pure contract. The vocabulary
 * lives in domain/muscle-map.ts (the repo rule: thinking is pure and tested
 * in domain/; the screens are surface). Import from here inside ui/.
 */
export {
  MAP_VIEW_H,
  MAP_VIEW_W,
  MUSCLE_IDS,
  MUSCLE_LABEL,
  MUSCLE_ZONE,
  focusFor,
  muscleIdsFor,
  normaliseMuscleGroup,
} from '@/domain/muscle-map';
export type { MapFocus, MuscleId, MusclePathSides, MusclePathTable, MuscleView, MuscleZone } from '@/domain/muscle-map';
