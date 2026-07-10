/**
 * Port of the pure functions of `domain/avatar_stats.py`: rarity, stage,
 * branch, evolution names. The DB-coupled `calculate_avatar_stats()` and
 * friends stay behind in Python until Phase 3 (they read Supabase; TanStack
 * Query hooks guard them there, goldens guard these here).
 *
 * NOTE: `avatarRarity`'s colours are the PYTHON badge palette, which knowingly
 * differs from the CSS aura palette in src/theme/tokens.js (only COMMON
 * agrees). Pinned as shipped -- see MIGRATION_PLAN "What stays exactly as-is".
 */

import { pyInt } from './py';
import { safeNum } from './physique-ratings';

function intOrThrow(level: unknown): number {
  const lv = pyInt(level);
  if (lv === null) {
    throw new TypeError(`int(): unparseable ${String(level)}`);
  }
  return lv;
}

export function getAvatarStage(level: unknown): number {
  const lv = intOrThrow(level);
  if (lv >= 75) return 4;
  if (lv >= 50) return 3;
  if (lv >= 25) return 2;
  return 1;
}

export function getBranchStage(branch: unknown, level: unknown): number {
  const lv = intOrThrow(level);
  const br = String(branch).toLowerCase();
  if (br === 'aesthetic') {
    return getAvatarStage(lv);
  }
  if (lv >= 75) return 3;
  if (lv >= 50) return 2;
  return 1;
}

export interface BranchScores {
  strength_score?: unknown;
  size_score?: unknown;
  conditioning_score?: unknown;
  aesthetic_score?: unknown;
}

export type Branch = 'mass' | 'hybrid' | 'aesthetic';

export function determineAvatarBranch(stats: BranchScores): Branch {
  const strength = safeNum(stats.strength_score ?? null, 0);
  const size = safeNum(stats.size_score ?? null, 0);
  const conditioning = safeNum(stats.conditioning_score ?? null, 0);
  const aesthetic = safeNum(stats.aesthetic_score ?? null, 0);

  if (size >= Math.max(aesthetic, conditioning) && strength >= 55 && size >= 55) {
    return 'mass';
  }
  if (conditioning >= 55 && strength >= 45) {
    return 'hybrid';
  }
  return 'aesthetic';
}

export function branchDisplayName(branch: unknown): string {
  const names: Record<string, string> = {
    aesthetic: '💎 Aesthetic',
    mass: '🦍 Mass Monster',
    hybrid: '⚡ Hybrid Athlete',
  };
  return names[String(branch).toLowerCase()] ?? '💎 Aesthetic';
}

export interface Rarity {
  name: string;
  icon: string;
  colour: string;
}

export function avatarRarity(level: unknown): Rarity {
  const lv = intOrThrow(level);
  if (lv >= 100) return { name: 'MYTHIC', icon: '🌌', colour: '#c084fc' };
  if (lv >= 75) return { name: 'LEGENDARY', icon: '👑', colour: '#facc15' };
  if (lv >= 50) return { name: 'EPIC', icon: '🔥', colour: '#38bdf8' };
  if (lv >= 25) return { name: 'RARE', icon: '💎', colour: '#7dd3fc' };
  return { name: 'COMMON', icon: '⚡', colour: '#94a3b8' };
}

/**
 * The CSS class suffix for a level's rarity: `rarity-epic`, `rarity-common`.
 * Never throws: an unparseable level renders as common rather than crashing.
 */
export function raritySlug(level: unknown): string {
  const lv = pyInt(level);
  if (lv === null) {
    return 'common';
  }
  return avatarRarity(lv).name.toLowerCase();
}

export function evolutionName(branch: unknown, level: unknown): string {
  const lv = intOrThrow(level);
  const br = String(branch).toLowerCase();
  if (br === 'mass') {
    if (lv >= 75) return 'Titan Form';
    if (lv >= 50) return 'Mass Monster';
    if (lv >= 25) return 'Iron Bulk';
    return 'Cyber Recruit';
  }
  if (br === 'hybrid') {
    if (lv >= 75) return 'Apex Hybrid';
    if (lv >= 50) return 'Tactical Athlete';
    if (lv >= 25) return 'Hybrid Rookie';
    return 'Cyber Recruit';
  }
  // True Adam is the level-100 final form -- matches the true_adam achievement
  // ("Reached level 100."), RANK_TIERS and avatarStageRows. The Python side
  // read >= 90 until 2026-07-11; both sides now say 100 and the goldens pin it.
  if (lv >= 100) return 'True Adam';
  if (lv >= 75) return 'Chad-Lite';
  if (lv >= 50) return 'Elite Aesthetic';
  if (lv >= 25) return 'Rising Aesthetic';
  return 'Cyber Recruit';
}
