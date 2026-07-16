import { CHAMPIONS } from './champions';
import type { AiPersonality, ChampionId, RivalDefinition } from './types';

/**
 * SIMULATED RIVAL — generated from player-level data (no networking tonight).
 * The default rival is VEX. The data model carries an `id` so a real userId
 * can replace the simulation later without touching the battle code.
 */

export const DEFAULT_RIVAL: RivalDefinition = {
  id: 'rival_vex',
  name: 'Vex',
  championId: 'shredded',
  ai: 'aggressive',
};

/** Pick the rival's champion from the player's Forge Level (variety without
 *  networking) — deterministic so the rivalry feels persistent. */
export function rivalFor(forgeLevel: number): RivalDefinition {
  const champions: ChampionId[] = ['shredded', 'aesthetic', 'apex', 'titan'];
  const idx = Math.abs(Math.trunc(forgeLevel)) % champions.length;
  const championId = champions[idx];
  const ai: AiPersonality = championId === 'titan' ? 'defensive' : championId === 'apex' ? 'balanced' : 'aggressive';
  return { ...DEFAULT_RIVAL, championId, ai };
}

export function rivalChampionName(r: RivalDefinition): string {
  return CHAMPIONS[r.championId].name;
}
