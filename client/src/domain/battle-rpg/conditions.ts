/**
 * GYM CONDITIONS (FireRed plan Phase C) — each gym arena applies one visible
 * ambient rule to BOTH sides. Pure engine modifiers: the resolver looks the
 * condition up by BattleState.conditionId; the UI banners it at entry.
 */

export interface GymCondition {
  id: string;
  label: string;
  blurb: string;
  /** Multiplies heavy + ultimate move damage (both sides). */
  heavyMult?: number;
  /** Flat stamina regen bonus per turn (both sides). */
  regenBonus?: number;
  /** Added to crit chance (both sides). */
  critBonus?: number;
}

export const GYM_CONDITIONS: Record<string, GymCondition> = {
  iron_foundry: {
    id: 'iron_foundry',
    label: 'HEAVY IRON',
    blurb: 'Heavy and ultimate moves hit 15% harder — both sides.',
    heavyMult: 1.15,
  },
  velocity_lab: {
    id: 'velocity_lab',
    label: 'TEMPO FLOOR',
    blurb: 'The pace never drops — +2 stamina regen per turn, both sides.',
    regenBonus: 2,
  },
  mirror_hall: {
    id: 'mirror_hall',
    label: 'MIRROR FOCUS',
    blurb: 'Every angle visible — +5% crit chance, both sides.',
    critBonus: 0.05,
  },
};

export function conditionById(id: string | null | undefined): GymCondition | null {
  return id ? GYM_CONDITIONS[id] ?? null : null;
}
