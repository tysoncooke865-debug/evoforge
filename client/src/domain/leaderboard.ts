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
