/**
 * Port of the pure part of `domain/cardio.py` + `domain/xp_ledger.py`'s
 * cardio amount rule.
 */

import { pyFloat } from './py';
import { XP_PER_CARDIO_MINUTE } from './xp';

/**
 * XP for a cardio session. MIRRORS migrations/002 STEP 3 EXACTLY:
 * `floor(minutes * 2)::int`, zero when that rounds to nothing. Diverge from
 * that literal and the backfill and the live path disagree -- precisely the
 * drift STEP 4 exists to catch, months later, against real user data.
 * Pinned by the cardio_event_amount goldens.
 */
export function cardioEventAmount(minutes: unknown): number {
  const m = pyFloat(minutes);
  if (m === null || Number.isNaN(m)) {
    return 0;
  }
  const amount = Math.floor(m * XP_PER_CARDIO_MINUTE);
  return Math.max(0, Math.trunc(amount));
}

export const CARDIO_TYPES = [
  'Treadmill incline walk',
  'Outdoor walk',
  'Run',
  'Bike',
  'Stairmaster',
  'Boxing',
  'Other',
] as const;
