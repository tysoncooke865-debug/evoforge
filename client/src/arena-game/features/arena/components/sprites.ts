/**
 * Sprite registry — pixel art from Kenney's 1-Bit Pack (CC0, kenney.nl),
 * recolored into the EvoForge palette at build time by
 * client/scripts/arena-sprite-tools.mjs (see ASSETS.md for provenance).
 * Requires must be static string literals for Metro, hence the explicit
 * table.
 *
 * Keys: `<artKey>--<variant>` where artKey is CardDefinition.art /
 * ChampionDefinition.art / 'forge-core', and variant is 'player'/'opponent'
 * for team-tinted units or the Avatar Path slug for the five champions.
 */
import type { ImageSourcePropType } from 'react-native';

const SPRITES: Record<string, ImageSourcePropType> = {
  'recruit--player': require('../sprites/recruit--player.png'),
  'recruit--opponent': require('../sprites/recruit--opponent.png'),
  'titan-guard--player': require('../sprites/titan-guard--player.png'),
  'titan-guard--opponent': require('../sprites/titan-guard--opponent.png'),
  'neon-boxer--player': require('../sprites/neon-boxer--player.png'),
  'neon-boxer--opponent': require('../sprites/neon-boxer--opponent.png'),
  'cardio-runner--player': require('../sprites/cardio-runner--player.png'),
  'cardio-runner--opponent': require('../sprites/cardio-runner--opponent.png'),
  'shadow-striker--player': require('../sprites/shadow-striker--player.png'),
  'shadow-striker--opponent': require('../sprites/shadow-striker--opponent.png'),
  'drone-archer--player': require('../sprites/drone-archer--player.png'),
  'drone-archer--opponent': require('../sprites/drone-archer--opponent.png'),
  'cyber-medic--player': require('../sprites/cyber-medic--player.png'),
  'cyber-medic--opponent': require('../sprites/cyber-medic--opponent.png'),
  'heavy-tank--player': require('../sprites/heavy-tank--player.png'),
  'heavy-tank--opponent': require('../sprites/heavy-tank--opponent.png'),
  'support-drone--player': require('../sprites/support-drone--player.png'),
  'support-drone--opponent': require('../sprites/support-drone--opponent.png'),
  'blade-runner--player': require('../sprites/blade-runner--player.png'),
  'blade-runner--opponent': require('../sprites/blade-runner--opponent.png'),
  'champion-aesthetic--aesthetic': require('../sprites/champion-aesthetic--aesthetic.png'),
  'champion-titan--titan': require('../sprites/champion-titan--titan.png'),
  'champion-mass--mass': require('../sprites/champion-mass--mass.png'),
  'champion-shredder--shredder': require('../sprites/champion-shredder--shredder.png'),
  'champion-cardio--cardio': require('../sprites/champion-cardio--cardio.png'),
  'forge-core--player': require('../sprites/forge-core--player.png'),
  'forge-core--opponent': require('../sprites/forge-core--opponent.png'),
};

/** Team-tinted unit sprite for a card art key; null → caller falls back to dots. */
export function unitSprite(artKey: string, team: 'player' | 'opponent'): ImageSourcePropType | null {
  return SPRITES[`${artKey}--${team}`] ?? null;
}

/** Path-colored champion sprite for a champion art key (e.g. 'champion-titan'). */
export function championSprite(artKey: string, path: string): ImageSourcePropType | null {
  return SPRITES[`${artKey}--${path}`] ?? null;
}

export function coreSprite(team: 'player' | 'opponent'): ImageSourcePropType {
  return SPRITES[`forge-core--${team}`];
}
