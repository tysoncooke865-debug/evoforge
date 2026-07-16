/**
 * HOME_REDESIGN — the ONE source of Home feature flags. Every conditional
 * section reads this object; no scattered booleans in the component tree.
 *
 * Dev constants for now (remote config is a later seam). The rule they
 * enforce: A SYSTEM WITHOUT A BACKEND IS HIDDEN, NEVER MOCKED. Flipping a
 * flag on is only legal once the real system behind it exists.
 */
export const homeFeatures = {
  /** No cosmetic inventory exists yet — the hero's LOADOUT action stays
   *  hidden until one does (never a dead button). */
  showLoadout: false,
  /** Routes to /customise — the champion select + skin/aura/emote
   *  customiser (real since 2026-07-16). */
  showCustomise: true,
  /** Coins are real (RPC coin_total, migration 013 family). */
  showCoins: true,
  /** The mission reward strip shows XP ONLY — the one real per-workout
   *  grant (10/set). Coins are never implied per-workout. */
  showMissionRewards: true,
} as const;

export type HomeFeatures = typeof homeFeatures;
