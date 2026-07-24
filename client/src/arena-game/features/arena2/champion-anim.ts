/**
 * Arena 2.0 — champion animation binding (Redesign P0).
 *
 * Binds the AutoSprite import output to the runtime: the per-clip 128px sheets
 * (static `require` table — Metro needs literals) and the metadata emitted by
 * `scripts/arena-autosprite-import.mjs` into `content/champion-anim/<c>.anim.json`.
 * The AnimationController (`champion-controller.ts`) + `atlas-sprite.tsx` read
 * from here. Sheets are keyed `<champion>/<clip>`; only fielded champions' sheets
 * should be referenced so Metro can tree-shake unfielded ones (lazy-load plan,
 * ARENA_2.0_REDESIGN.md §17-E).
 */
import type { ImageSourcePropType } from 'react-native';
import shredderMeta from '../../content/champion-anim/shredder.anim.json';

export type ClipName = 'idle' | 'run' | 'attack' | 'hit' | 'dash' | 'ultimate';

export interface ClipMeta {
  /** Sheet filename (matched in the SHEETS require table by `<champion>/<clip>`). */
  sheet: string;
  cols: number;
  rows: number;
  count: number;
  /** Source cell size in px (128 for the benchmark). */
  cell: number;
  fps: number;
  loop: boolean;
  /** Feet offset (source px) vs the champion's reference clip — the renderer
   *  shifts the sprite up by this so every clip's feet share one ground line. */
  anchorYOffset: number;
  /** Frame the strike lands on (attack/ultimate) — drives hit FX at P2+. */
  hitFrame?: number;
  /** Invulnerability window [startFrame, endFrame] (dash) — used at P2+. */
  iFrames?: [number, number];
}

export interface ChampionAnim {
  champion: string;
  cell: number;
  refFeetY: number;
  clips: Record<ClipName, ClipMeta>;
}

const META: Record<string, ChampionAnim> = {
  shredder: shredderMeta as ChampionAnim,
};

const SHEETS: Record<string, ImageSourcePropType> = {
  'shredder/idle': require('./sprites/shredder/idle.png'),
  'shredder/run': require('./sprites/shredder/run.png'),
  'shredder/attack': require('./sprites/shredder/attack.png'),
  'shredder/hit': require('./sprites/shredder/hit.png'),
  'shredder/dash': require('./sprites/shredder/dash.png'),
  'shredder/ultimate': require('./sprites/shredder/ultimate.png'),
};

/** Metadata for a champion, or null if not imported. */
export function championAnim(champion: string): ChampionAnim | null {
  return META[champion] ?? null;
}

/** The 128px sheet for a champion's clip, or null when not registered. */
export function clipSheet(champion: string, clip: ClipName): ImageSourcePropType | null {
  return SHEETS[`${champion}/${clip}`] ?? null;
}

export const CLIP_ORDER: ClipName[] = ['idle', 'run', 'attack', 'hit', 'dash', 'ultimate'];
