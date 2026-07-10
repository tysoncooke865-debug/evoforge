/** Port of the pure part of `domain/xp_leveling.py`: the stage ladder. */

import { pyInt } from './py';

export interface StageRow {
  level: number;
  name: string;
  stage: number;
  unlocked: boolean;
  current: boolean;
}

export function avatarStageRows(branch: unknown, currentLevel: unknown): StageRow[] {
  const br = String(branch).toLowerCase();
  const lv = pyInt(currentLevel);
  if (lv === null) {
    throw new TypeError(`int(): unparseable ${String(currentLevel)}`);
  }

  let rows: [number, string, number][];
  if (br === 'mass') {
    rows = [
      [1, 'Cyber Recruit', 1],
      [25, 'Iron Bulk', 1],
      [50, 'Mass Monster', 2],
      [75, 'Titan Form', 3],
      [100, 'Titan Prime', 3],
    ];
  } else if (br === 'hybrid') {
    rows = [
      [1, 'Cyber Recruit', 1],
      [25, 'Hybrid Rookie', 1],
      [50, 'Tactical Athlete', 2],
      [75, 'Apex Hybrid', 3],
      [100, 'Legendary Hybrid', 3],
    ];
  } else {
    rows = [
      [1, 'Cyber Recruit', 1],
      [25, 'Rising Aesthetic', 2],
      [50, 'Elite Aesthetic', 3],
      [75, 'Chad-Lite', 4],
      [100, 'True Adam', 4],
    ];
  }

  const unlockedLevels = rows.filter(([unlock]) => lv >= unlock).map(([unlock]) => unlock);
  const highestUnlocked = unlockedLevels.length > 0 ? Math.max(...unlockedLevels) : null;

  return rows.map(([unlockLevel, name, stage]) => ({
    level: unlockLevel,
    name,
    stage,
    unlocked: lv >= unlockLevel,
    current: lv >= unlockLevel && unlockLevel === highestUnlocked,
  }));
}
