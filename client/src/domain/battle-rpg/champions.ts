import type { BattleStats, ChampionId, SpriteBranch } from './types';

/**
 * THE FOUR BETA CHAMPIONS. Each borrows an existing avatar branch's sprite
 * (no new art): Elite Aesthetic → aesthetic, Titan Form → titan (Mass
 * Monster body), Apex Engine → cardio (Enduro), Shredded → shredder.
 *
 * `base` is the archetype's identity BEFORE the player's real stats scale it
 * (see stat-scaler.ts). Values are hand-tuned around a ~110 HP / ~100 stamina
 * frame so battles land in the 6–12 turn window.
 */

export interface ChampionDef {
  id: ChampionId;
  name: string;
  role: string;
  identity: string;
  spriteBranch: SpriteBranch;
  /** Archetype base combat stats (currentHealth/Stamina filled at build). */
  base: Omit<BattleStats, 'currentHealth' | 'currentStamina'>;
  accent: 'accent' | 'legendary' | 'success' | 'danger';
}

export const CHAMPIONS: Record<ChampionId, ChampionDef> = {
  aesthetic: {
    id: 'aesthetic',
    name: 'Elite Aesthetic',
    role: 'Precision Fighter',
    identity: 'Critical hits, counters, technical accuracy.',
    spriteBranch: 'aesthetic',
    accent: 'accent',
    base: {
      maxHealth: 108,
      maxStamina: 100,
      power: 20,
      defence: 14,
      speed: 17,
      precision: 20,
      evasion: 0.1,
      critChance: 0.18,
      critMultiplier: 1.7,
      staminaRegen: 14,
    },
  },
  titan: {
    id: 'titan',
    name: 'Titan Form',
    role: 'Heavy Tank',
    identity: 'Huge HP, defence, staggering power.',
    spriteBranch: 'titan',
    accent: 'legendary',
    // Rebalanced 2026-07-18 (Phase C sim): at stat parity Titan won 96% of
    // AI-vs-AI games — the HP/def/power mix beats speed/evasion under this
    // engine, and FORCE supers two of three foes. Tank identity stays; the
    // wall comes down. battle-balance.test.ts holds the bounds.
    base: {
      maxHealth: 122,
      maxStamina: 88,
      power: 20,
      defence: 14,
      speed: 9,
      precision: 12,
      evasion: 0.04,
      critChance: 0.1,
      critMultiplier: 1.6,
      staminaRegen: 10,
    },
  },
  apex: {
    id: 'apex',
    name: 'Apex Engine',
    role: 'Speed & Endurance',
    identity: 'Fast, tireless, relentless.',
    spriteBranch: 'cardio',
    accent: 'success',
    // Rebalanced 2026-07-18 (Phase C sim): apex won 1% at parity — speed and
    // stamina never became damage. Its motor now hits.
    base: {
      maxHealth: 106,
      maxStamina: 116,
      power: 19,
      defence: 12,
      speed: 22,
      precision: 15,
      evasion: 0.14,
      critChance: 0.14,
      critMultiplier: 1.5,
      staminaRegen: 20,
    },
  },
  shredded: {
    id: 'shredded',
    name: 'Shredded',
    role: 'Agile Combo Fighter',
    identity: 'Bleed, dodge, combo chains, finishers.',
    spriteBranch: 'shredder',
    accent: 'danger',
    base: {
      maxHealth: 104,
      maxStamina: 100,
      power: 18,
      defence: 11,
      speed: 20,
      precision: 17,
      evasion: 0.13,
      critChance: 0.15,
      critMultiplier: 1.6,
      staminaRegen: 15,
    },
  },
};

export const CHAMPION_LIST: ChampionDef[] = Object.values(CHAMPIONS);

/** Map an equipped avatar branch to the nearest playable champion. */
export function championForBranch(branch: SpriteBranch): ChampionId {
  switch (branch) {
    case 'titan':
    case 'mass':
      return 'titan';
    case 'cardio':
    case 'hybrid':
      return 'apex';
    case 'shredder':
      return 'shredded';
    default:
      return 'aesthetic';
  }
}
