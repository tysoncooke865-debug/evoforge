/**
 * Sprite registry — PixelLab-generated pixel art (see ASSETS.md provenance),
 * post-processed by client/scripts/arena-pixellab-gen.mjs: every character
 * gets a team-colored outline variant per side (team read = outline +
 * health bar + chevron + base plate; the art itself carries card/champion
 * identity, champions carry their path colors in the art).
 * Requires must be static string literals for Metro, hence the explicit
 * table. The legacy Kenney 1-bit sprites remain in ../sprites/ as the
 * documented last-resort fallback source (ASSETS.md).
 *
 * Keys: `<artKey>--<team>` for units AND champions ('player'/'opponent'),
 * `forge-core-<team>[-damaged]`, 'arena-floor'.
 */
import type { ImageSourcePropType } from 'react-native';

const SPRITES: Record<string, ImageSourcePropType> = {
  'recruit--player': require('../sprites/px/recruit--player.png'),
  'recruit--opponent': require('../sprites/px/recruit--opponent.png'),
  'titan-guard--player': require('../sprites/px/titan-guard--player.png'),
  'titan-guard--opponent': require('../sprites/px/titan-guard--opponent.png'),
  'neon-boxer--player': require('../sprites/px/neon-boxer--player.png'),
  'neon-boxer--opponent': require('../sprites/px/neon-boxer--opponent.png'),
  'cardio-runner--player': require('../sprites/px/cardio-runner--player.png'),
  'cardio-runner--opponent': require('../sprites/px/cardio-runner--opponent.png'),
  'shadow-striker--player': require('../sprites/px/shadow-striker--player.png'),
  'shadow-striker--opponent': require('../sprites/px/shadow-striker--opponent.png'),
  'drone-archer--player': require('../sprites/px/drone-archer--player.png'),
  'drone-archer--opponent': require('../sprites/px/drone-archer--opponent.png'),
  'cyber-medic--player': require('../sprites/px/cyber-medic--player.png'),
  'cyber-medic--opponent': require('../sprites/px/cyber-medic--opponent.png'),
  'heavy-tank--player': require('../sprites/px/heavy-tank--player.png'),
  'heavy-tank--opponent': require('../sprites/px/heavy-tank--opponent.png'),
  'support-drone--player': require('../sprites/px/support-drone--player.png'),
  'support-drone--opponent': require('../sprites/px/support-drone--opponent.png'),
  'blade-runner--player': require('../sprites/px/blade-runner--player.png'),
  'blade-runner--opponent': require('../sprites/px/blade-runner--opponent.png'),
  'champion-aesthetic--player': require('../sprites/px/champion-aesthetic--player.png'),
  'champion-aesthetic--opponent': require('../sprites/px/champion-aesthetic--opponent.png'),
  'champion-titan--player': require('../sprites/px/champion-titan--player.png'),
  'champion-titan--opponent': require('../sprites/px/champion-titan--opponent.png'),
  'champion-mass--player': require('../sprites/px/champion-mass--player.png'),
  'champion-mass--opponent': require('../sprites/px/champion-mass--opponent.png'),
  'champion-shredder--player': require('../sprites/px/champion-shredder--player.png'),
  'champion-shredder--opponent': require('../sprites/px/champion-shredder--opponent.png'),
  'champion-cardio--player': require('../sprites/px/champion-cardio--player.png'),
  'champion-cardio--opponent': require('../sprites/px/champion-cardio--opponent.png'),
  'champion-aesthetic--player--w0': require('../sprites/px/champion-aesthetic--player--w0.png'),
  'champion-aesthetic--player--w1': require('../sprites/px/champion-aesthetic--player--w1.png'),
  'champion-aesthetic--player--w2': require('../sprites/px/champion-aesthetic--player--w2.png'),
  'champion-aesthetic--player--w3': require('../sprites/px/champion-aesthetic--player--w3.png'),
  'champion-aesthetic--opponent--w0': require('../sprites/px/champion-aesthetic--opponent--w0.png'),
  'champion-aesthetic--opponent--w1': require('../sprites/px/champion-aesthetic--opponent--w1.png'),
  'champion-aesthetic--opponent--w2': require('../sprites/px/champion-aesthetic--opponent--w2.png'),
  'champion-aesthetic--opponent--w3': require('../sprites/px/champion-aesthetic--opponent--w3.png'),
  'champion-titan--player--w0': require('../sprites/px/champion-titan--player--w0.png'),
  'champion-titan--player--w1': require('../sprites/px/champion-titan--player--w1.png'),
  'champion-titan--player--w2': require('../sprites/px/champion-titan--player--w2.png'),
  'champion-titan--player--w3': require('../sprites/px/champion-titan--player--w3.png'),
  'champion-titan--opponent--w0': require('../sprites/px/champion-titan--opponent--w0.png'),
  'champion-titan--opponent--w1': require('../sprites/px/champion-titan--opponent--w1.png'),
  'champion-titan--opponent--w2': require('../sprites/px/champion-titan--opponent--w2.png'),
  'champion-titan--opponent--w3': require('../sprites/px/champion-titan--opponent--w3.png'),
  'champion-mass--player--w0': require('../sprites/px/champion-mass--player--w0.png'),
  'champion-mass--player--w1': require('../sprites/px/champion-mass--player--w1.png'),
  'champion-mass--player--w2': require('../sprites/px/champion-mass--player--w2.png'),
  'champion-mass--player--w3': require('../sprites/px/champion-mass--player--w3.png'),
  'champion-mass--opponent--w0': require('../sprites/px/champion-mass--opponent--w0.png'),
  'champion-mass--opponent--w1': require('../sprites/px/champion-mass--opponent--w1.png'),
  'champion-mass--opponent--w2': require('../sprites/px/champion-mass--opponent--w2.png'),
  'champion-mass--opponent--w3': require('../sprites/px/champion-mass--opponent--w3.png'),
  'champion-shredder--player--w0': require('../sprites/px/champion-shredder--player--w0.png'),
  'champion-shredder--player--w1': require('../sprites/px/champion-shredder--player--w1.png'),
  'champion-shredder--player--w2': require('../sprites/px/champion-shredder--player--w2.png'),
  'champion-shredder--player--w3': require('../sprites/px/champion-shredder--player--w3.png'),
  'champion-shredder--opponent--w0': require('../sprites/px/champion-shredder--opponent--w0.png'),
  'champion-shredder--opponent--w1': require('../sprites/px/champion-shredder--opponent--w1.png'),
  'champion-shredder--opponent--w2': require('../sprites/px/champion-shredder--opponent--w2.png'),
  'champion-shredder--opponent--w3': require('../sprites/px/champion-shredder--opponent--w3.png'),
  'champion-cardio--player--w0': require('../sprites/px/champion-cardio--player--w0.png'),
  'champion-cardio--player--w1': require('../sprites/px/champion-cardio--player--w1.png'),
  'champion-cardio--player--w2': require('../sprites/px/champion-cardio--player--w2.png'),
  'champion-cardio--player--w3': require('../sprites/px/champion-cardio--player--w3.png'),
  'champion-cardio--opponent--w0': require('../sprites/px/champion-cardio--opponent--w0.png'),
  'champion-cardio--opponent--w1': require('../sprites/px/champion-cardio--opponent--w1.png'),
  'champion-cardio--opponent--w2': require('../sprites/px/champion-cardio--opponent--w2.png'),
  'champion-cardio--opponent--w3': require('../sprites/px/champion-cardio--opponent--w3.png'),
  'forge-core-player': require('../sprites/px/forge-core-player.png'),
  'forge-core-opponent': require('../sprites/px/forge-core-opponent.png'),
  'forge-core-player-damaged': require('../sprites/px/forge-core-player-damaged.png'),
  'forge-core-opponent-damaged': require('../sprites/px/forge-core-opponent-damaged.png'),
  'arena-floor': require('../sprites/px/arena-floor.png'),
};

/** Team-outlined unit sprite for a card art key; null → caller falls back to dots. */
export function unitSprite(artKey: string, team: 'player' | 'opponent'): ImageSourcePropType | null {
  return SPRITES[`${artKey}--${team}`] ?? null;
}

/**
 * Team-outlined champion sprite for a champion art key (e.g. 'champion-titan').
 * Path identity is baked into the art; the outline carries the fielding team.
 */
export function championSprite(
  artKey: string,
  team: 'player' | 'opponent'
): ImageSourcePropType | null {
  return SPRITES[`${artKey}--${team}`] ?? null;
}

/**
 * P4 champion walk cycle: the 4 team-outlined frames for a champion, or
 * null when frames are missing (renderer then shows the static sprite).
 * Frame 0 is anchored to the base sprite, so cycling always starts from the
 * champion's canonical look.
 */
export function championWalkFrames(
  artKey: string,
  team: 'player' | 'opponent'
): ImageSourcePropType[] | null {
  const frames: ImageSourcePropType[] = [];
  for (let i = 0; i < 4; i++) {
    const frame = SPRITES[`${artKey}--${team}--w${i}`];
    if (!frame) return null;
    frames.push(frame);
  }
  return frames;
}

/** Registry key suffix for a profile variant (premium P5): stage always,
 *  skin only when non-standard — `champion-titan--s3--k-inferno--player`. */
function variantPrefix(artKey: string, stage: number, skinId: string): string {
  const skin = skinId && skinId !== 'standard' ? `--k-${skinId}` : '';
  return `${artKey}--s${stage}${skin}`;
}

/**
 * Stage/skin-aware champion variant (premium P5). Null until Phase 8+
 * generates variant art — callers then fall back through the fidelity
 * chain in battle-assets-core.ts, never to a broken image.
 */
export function championSpriteVariant(
  artKey: string,
  team: 'player' | 'opponent',
  stage: number,
  skinId: string
): ImageSourcePropType | null {
  return SPRITES[`${variantPrefix(artKey, stage, skinId)}--${team}`] ?? null;
}

/** Variant walk frames — all 4 or nothing (a variant still must never cycle
 *  canonical frames: layer-drift rule, battle-assets-core.ts). */
export function championWalkFramesVariant(
  artKey: string,
  team: 'player' | 'opponent',
  stage: number,
  skinId: string
): ImageSourcePropType[] | null {
  const frames: ImageSourcePropType[] = [];
  for (let i = 0; i < 4; i++) {
    const frame = SPRITES[`${variantPrefix(artKey, stage, skinId)}--${team}--w${i}`];
    if (!frame) return null;
    frames.push(frame);
  }
  return frames;
}

/** Forge Core art; swaps to the cracked variant once the core is battered. */
export function coreSprite(team: 'player' | 'opponent', damaged = false): ImageSourcePropType {
  return SPRITES[`forge-core-${team}${damaged ? '-damaged' : ''}`];
}

/** The lane floor texture (shared by both lanes). */
export function arenaFloorTexture(): ImageSourcePropType {
  return SPRITES['arena-floor'];
}
