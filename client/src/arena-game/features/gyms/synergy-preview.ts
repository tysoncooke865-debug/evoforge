/**
 * Squad synergy preview (P12) — a pure function over squad champion tags +
 * the active deck that mirrors the engine's counting rules
 * (game-engine/synergies/synergies.ts):
 *
 *  - Tag synergies count combatants carrying the tag. Squad champions
 *    (captain + borrowed) are guaranteed living combatants from tick 0
 *    (createBattle seeds the initial aura snapshot from starting
 *    composition), so a squad-only count meeting the threshold is LIVE
 *    FROM SPAWN — pinned against the engine by test (gym-roles.test.ts).
 *  - 'mixed-paths' counts DISTINCT path tags, same as the engine.
 *  - Deck potential counts DISTINCT fighter cards in the deck carrying the
 *    tag (techniques/equipment never spawn combatants). This deliberately
 *    UNDER-states the ceiling — the engine counts living copies, so
 *    replaying one fighter can also stack a tag — which keeps the preview
 *    honest: it never promises more than the squad + one deploy of each
 *    fighter can deliver, and never claims a synergy is unreachable.
 */
import { getCardById, getChampionById, SYNERGIES } from '../../content';
import { ALL_AVATAR_PATHS, UnitTag } from '../../game-engine/types';

const PATH_TAGS: ReadonlySet<string> = new Set(ALL_AVATAR_PATHS);

export interface SquadSynergyPreviewEntry {
  synergyId: string;
  name: string;
  description: string;
  threshold: number;
  /** Squad champions (captain + borrowed) carrying the tag — living combatants from tick 0. */
  squadCount: number;
  /**
   * Distinct fighter cards in the active deck that can add to the count
   * (for 'mixed-paths': distinct deck-fighter paths NOT already in the squad).
   */
  deckFighterCount: number;
  /** True when the squad alone meets the threshold — active from tick 0. */
  activeFromSpawn: boolean;
}

/**
 * Previews every content synergy for a squad (champion ids, captain first)
 * and the active deck's card ids. Unknown ids are skipped (fail-soft, same
 * as the engine's content lookups). Pure: no mutation, no state.
 */
export function previewSquadSynergies(
  squadChampionIds: readonly string[],
  deckCardIds: readonly string[]
): SquadSynergyPreviewEntry[] {
  const squadTagCounts = new Map<UnitTag, number>();
  const squadPaths = new Set<string>();
  for (const id of squadChampionIds) {
    const champion = getChampionById(id);
    if (!champion) continue;
    for (const tag of champion.tags) {
      squadTagCounts.set(tag, (squadTagCounts.get(tag) ?? 0) + 1);
      if (PATH_TAGS.has(tag)) squadPaths.add(tag);
    }
  }

  const deckTagCounts = new Map<UnitTag, number>();
  const deckPaths = new Set<string>();
  for (const id of deckCardIds) {
    const card = getCardById(id);
    if (!card || card.category !== 'fighter') continue; // only fighters spawn combatants
    for (const tag of card.tags) {
      deckTagCounts.set(tag, (deckTagCounts.get(tag) ?? 0) + 1);
      if (PATH_TAGS.has(tag)) deckPaths.add(tag);
    }
  }

  return SYNERGIES.map((synergy) => {
    const squadCount =
      synergy.tag === 'mixed-paths' ? squadPaths.size : (squadTagCounts.get(synergy.tag) ?? 0);
    const deckFighterCount =
      synergy.tag === 'mixed-paths'
        ? [...deckPaths].filter((p) => !squadPaths.has(p)).length
        : (deckTagCounts.get(synergy.tag) ?? 0);
    return {
      synergyId: synergy.id,
      name: synergy.name,
      description: synergy.description,
      threshold: synergy.threshold,
      squadCount,
      deckFighterCount,
      activeFromSpawn: squadCount >= synergy.threshold,
    };
  });
}

/** True when at least one synergy is live from spawn for this squad. */
export function hasSpawnSynergy(entries: readonly SquadSynergyPreviewEntry[]): boolean {
  return entries.some((e) => e.activeFromSpawn);
}

/** Entries worth showing in the picker: any squad progress or deck support. */
export function relevantSynergyEntries(
  entries: readonly SquadSynergyPreviewEntry[]
): SquadSynergyPreviewEntry[] {
  return entries.filter((e) => e.squadCount > 0);
}
