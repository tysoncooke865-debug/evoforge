/**
 * Port of the leaderboard's pure logic (views/leaderboard.py + the pure part
 * of domain/public_profile.py).
 *
 * RANK BY AVATAR LEVEL, NOT RAW XP. Two athletes with equal XP but different
 * base levels sit at different levels, so XP order and level order can
 * disagree -- the board follows the level, computed through the ONE curve in
 * domain/xp. XP is the tiebreak within a level, then name. And a viewer whose
 * own account carries non-zero drift is refused the board entirely: a number
 * nothing cross-checks is a number nobody can defend.
 */

import { pyInt } from './py';
import { rankName } from './profile';
import { levelAndProgress } from './xp';

export const NAME_MIN = 3;
export const NAME_MAX = 24;

export interface LeaderboardRow {
  display_name?: unknown;
  xp?: unknown;
  base_level?: unknown;
  position?: unknown;
}

export interface RankedEntry {
  position: number;
  displayName: string;
  level: number;
  xp: number;
  rank: string;
  /** Multi-metric board extras (migration 065); absent on the legacy XP board. */
  forgeLevel?: number;
  evoRating?: number | null;
  momentumWeeks?: number;
}

export function rankLeaderboard(rows: LeaderboardRow[]): RankedEntry[] {
  const ranked = rows.map((row) => {
    const xp = pyInt(row.xp) ?? 0;
    const baseLevel = pyInt(row.base_level) ?? 1;
    const { level } = levelAndProgress(baseLevel, xp);
    return { displayName: String(row.display_name ?? ''), level, xp };
  });
  ranked.sort((a, b) => b.level - a.level || b.xp - a.xp || a.displayName.localeCompare(b.displayName));
  return ranked.map((e, i) => ({
    position: i + 1,
    displayName: e.displayName,
    level: e.level,
    xp: e.xp,
    rank: rankName(e.level),
  }));
}

/**
 * MULTI-METRIC BOARD (2026-07-19, migration 065). The `leaderboard_by_metric`
 * RPC already ORDERS and NUMBERS the rows server-side by the requested metric
 * (Evo Rating / Forge Level / Consistency / XP) and returns every metric per
 * row, so the client just carries them through in that order — it never
 * re-sorts (the server holds the integrity gate and the honest sources).
 */
export type LeaderboardMetric = 'evo' | 'forge' | 'consistency' | 'xp';

export const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  evo: 'EVO RATING',
  forge: 'FORGE LEVEL',
  consistency: 'CONSISTENCY',
  xp: 'TOTAL XP',
};

export interface MetricRow extends LeaderboardRow {
  forge_level?: unknown;
  evo_rating?: unknown;
  momentum_weeks?: unknown;
  rank_position?: unknown;
}

export function rankByMetric(rows: MetricRow[]): RankedEntry[] {
  return rows.map((row, i) => {
    const xp = pyInt(row.xp) ?? 0;
    const baseLevel = pyInt(row.base_level) ?? 1;
    const { level } = levelAndProgress(baseLevel, xp);
    const evoRaw = row.evo_rating;
    return {
      // The RPC's window-numbered position; fall back to array order.
      position: pyInt(row.rank_position) ?? i + 1,
      displayName: String(row.display_name ?? ''),
      level,
      xp,
      rank: rankName(level),
      forgeLevel: pyInt(row.forge_level) ?? level,
      // Null = the athlete keeps their Evo Rating private (or has none yet).
      evoRating: evoRaw === null || evoRaw === undefined ? null : pyInt(evoRaw),
      momentumWeeks: pyInt(row.momentum_weeks) ?? 0,
    };
  });
}

/** Why a display name is invalid, or null if fine. Clearing (null/empty) is allowed. */
export function nameError(displayName: string | null): string | null {
  if (displayName === null) return null;
  const name = displayName.trim();
  if (name === '') return null;
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return `Display name must be ${NAME_MIN}–${NAME_MAX} characters.`;
  }
  return null;
}
