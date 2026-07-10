/** Port of the pure part of `domain/profile.py`. */

import { RANK_TIERS } from './catalogs';
import { pyInt } from './py';

export function rankName(level: unknown): string {
  const lv = pyInt(level);
  if (lv === null) {
    throw new TypeError(`rank_name: unparseable level ${String(level)}`);
  }
  for (const [threshold, name] of RANK_TIERS) {
    if (lv >= threshold) {
      return name;
    }
  }
  return RANK_TIERS[RANK_TIERS.length - 1][1];
}
