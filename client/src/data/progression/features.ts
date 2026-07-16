/**
 * PROGRESSION_OVERHAUL — the ONE source of progression feature flags
 * (spec §44). Same doctrine as ui/home/home-features.ts: a system without
 * its backend phase shipped stays OFF, and nothing is ever mocked to look
 * shipped. Flip a flag only when its phase's acceptance gates are green.
 */
export const progressionFeatures = {
  /** Master switch: the Evo/Forge/Rival UI reads new sources when true. */
  newProgressionEnabled: false,
  /** Weekly Evo Reviews (P3). */
  evoReviewsEnabled: false,
  /** Monthly guided Evo Scans (P6). */
  monthlyScansEnabled: false,
  /** Rival Rank placements + rated matches (P7). */
  rivalRankEnabled: false,
  /** Ghost matches (P7). */
  ghostMatchesEnabled: false,
  /** Player Stats affecting gameplay simulation (P8). */
  playerStatsGameplayEnabled: false,
} as const;

export type ProgressionFeatures = typeof progressionFeatures;
