/**
 * Pure onboarding helpers (M10 beta hardening) — no React Native imports so
 * the routing decision and name sanitisation are testable headless.
 */
import type { SaveData } from '../persistence/save';

export type EntryRoute = '/forge-arena/onboarding' | '/forge-arena/lobby';

/** Longest display name the onboarding flow will persist. */
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
 * Sanitises a typed display name: collapses runs of whitespace, trims, and
 * caps the length. An empty result (or all-whitespace input) falls back to
 * `fallback` — skipping the name step keeps the default name.
 */
export function sanitizeDisplayName(input: string, fallback: string): string {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
