/**
 * Pure onboarding + first-run journey helpers (M10, extended P11) — no React
 * Native imports so the routing decision, identity sync and difficulty
 * gating are testable headless.
 *
 * P11 (integrated journey): the Arena lives INSIDE EvoForge, so identity is
 * EvoForge's — the onboarding flow no longer asks for a display name (audit
 * finding #9); `applyProviderIdentity` syncs the provider's name (and, until
 * onboarding completes, the Origin-derived champion) into the local save at
 * boot instead.
 */
import { getChampionById } from '../../content';
import type { AiDifficulty } from '../../content/balance';
import type { PlayerProfile } from '../../integration/evoforge/types';
import type { SaveData } from '../persistence/save';

export type EntryRoute = '/forge-arena/onboarding' | '/forge-arena/lobby';

/** Longest display name the save will persist (provider names are capped). */
export const MAX_DISPLAY_NAME_LENGTH = 24;

/**
 * Where "ENTER THE ARENA" on the title screen should land: first-time players
 * (onboarding not yet completed) go through /onboarding, everyone else goes
 * straight to the lobby.
 */
export function resolveEntryRoute(save: Pick<SaveData, 'player'>): EntryRoute {
  return save.player.onboardingComplete ? '/forge-arena/lobby' : '/forge-arena/onboarding';
}

/**
 * Sanitises a display name: collapses runs of whitespace, trims, and caps the
 * length. An empty result (or all-whitespace input) falls back to `fallback`.
 */
export function sanitizeDisplayName(input: string, fallback: string): string {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Sync the EvoForge provider identity into the Arena save (called once per
 * boot, after the player store initialises):
 *  - displayName always follows the provider (EvoForge's profile name is
 *    canonical — the Arena never asks for its own; audit #9). Sanitised;
 *    a blank provider name keeps the current save name.
 *  - championId adopts the provider's Origin-derived champion ONLY while
 *    onboarding is incomplete (a first-run prefill). Once the player has
 *    finished onboarding their own pick is never overridden. Unknown
 *    champion ids are ignored.
 *
 * Returns the SAME object when nothing changes, so callers can skip the
 * persist entirely on the common no-op path.
 */
export function applyProviderIdentity(save: SaveData, profile: PlayerProfile): SaveData {
  const displayName = sanitizeDisplayName(profile.displayName, save.player.displayName);
  const adoptChampion =
    !save.player.onboardingComplete && getChampionById(profile.championId) !== undefined;
  const championId = adoptChampion ? profile.championId : save.player.championId;
  if (displayName === save.player.displayName && championId === save.player.championId) {
    return save;
  }
  return { ...save, player: { ...save.player, displayName, championId } };
}

/**
 * First-battle difficulty gate (P11): 'training' is always available; the
 * harder AI tiers unlock once the player has won a battle on any tier. The
 * lobby treats the lock as advisory — a deliberate second tap selects a
 * locked tier anyway (explicit choice) — so this predicate only decides
 * what is PRESENTED as locked, never what is playable.
 */
export function isDifficultyUnlocked(
  save: Pick<SaveData, 'stats'>,
  difficulty: AiDifficulty
): boolean {
  if (difficulty === 'training') return true;
  return save.stats.wins >= 1;
}
