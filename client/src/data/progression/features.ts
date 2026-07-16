/**
 * PROGRESSION_OVERHAUL — the ONE source of progression feature flags
 * (spec §44). Same doctrine as ui/home/home-features.ts: a system without
 * its backend phase shipped stays OFF, and nothing is ever mocked to look
 * shipped. Flip a flag only when its phase's acceptance gates are green.
 */
export const progressionFeatures = {
  /** Master switch: the Evo/Forge/Rival UI reads new sources when true.
   *  FLIPPED ON at P5 cutover (2026-07-16) after production tours. */
  newProgressionEnabled: true,
  /** Weekly Evo Reviews (P3). */
  evoReviewsEnabled: true,
  /** Monthly guided Evo Scans (P6) — ON at P6 ship. */
  monthlyScansEnabled: true,
  /** Rival Rank placements + rated matches (P7) — ON at P7 ship. */
  rivalRankEnabled: true,
  /** Ghost matches (P7). */
  ghostMatchesEnabled: false,
  /** Player Stats affecting gameplay simulation (P8). */
  playerStatsGameplayEnabled: false,
} as const;

export type ProgressionFeatures = typeof progressionFeatures;
