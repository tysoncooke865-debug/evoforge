import type { BranchContext, BranchV2, ScoresV2 } from '@/domain/branches-v2';
import { buildRoster, originAsBranch } from '@/domain/customise';

import { CHAMPIONS } from './champions';
import type { ChampionId } from './types';

/**
 * CHAMPION UNLOCKING (Tyson, 2026-07-16) — you can only battle with champions
 * you've UNLOCKED, mirroring the CUSTOMISE roster's live branch gates. Each
 * battle champion maps to a training branch (aesthetic/titan/cardio/shredder);
 * it's playable iff that branch is unlocked (your current class or a gate you
 * have met). This is the single source of truth for both the select screen
 * and the versus picker.
 */

const BATTLE_CHAMPIONS: ChampionId[] = ['aesthetic', 'titan', 'apex', 'shredded'];

/** With an Origin assigned (originPath), the roster locks to it (THE ORIGIN
 *  LOCK) and so does the battle select — only the origin champion battles. */
export function unlockedChampionSet(
  derived: BranchV2,
  scores: ScoresV2,
  ctx?: BranchContext,
  originPath?: string | null
): Set<ChampionId> {
  const roster = buildRoster(derived, scores, ctx, originPath);
  const set = new Set<ChampionId>();
  for (const id of BATTLE_CHAMPIONS) {
    const branch = CHAMPIONS[id].spriteBranch;
    if (roster.find((e) => e.id === branch)?.unlocked) set.add(id);
  }
  return set;
}

/** A short "how to unlock" line for a locked champion (its nearest gate). */
export function championRequirement(
  id: ChampionId,
  derived: BranchV2,
  scores: ScoresV2,
  ctx?: BranchContext,
  originPath?: string | null
): string {
  const roster = buildRoster(derived, scores, ctx, originPath);
  const entry = roster.find((e) => e.id === CHAMPIONS[id].spriteBranch);
  if (!entry || entry.unlocked) return '';
  if (originAsBranch(originPath) !== null) return 'ORIGIN LOCKED';
  const unmet = entry.requirements.find((r) => !r.met);
  if (!unmet) return 'TRAIN TO UNLOCK';
  return `${unmet.label.toUpperCase()} ${Math.ceil(unmet.target)}+`;
}
