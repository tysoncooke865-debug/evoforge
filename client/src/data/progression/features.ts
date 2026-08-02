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
  /**
   * ORIGIN EVOLUTION PATH (beta, migrations 130-132).
   *
   * The BUILD-SIDE half of `evolution_path_beta`; the per-athlete half is
   * the remote flag on the existing command_flags framework, read through
   * `app_flag_enabled`. Both must pass, so this constant is an instant kill
   * switch: flipping it false pulls the UI in the next deploy without a
   * database change, and recorded progress is untouched — the tables and
   * the apply trigger keep working, so nothing is lost by turning it off.
   *
   * TRUE here does NOT mean "on for everyone": the remote flag ships
   * disabled at 0% rollout and is granted to named beta athletes.
   */
  evolutionPathEnabled: true,
  // (ghostMatchesEnabled / playerStatsGameplayEnabled deleted 2026-07-19 —
  //  zero references anywhere; D4.)
} as const;

export type ProgressionFeatures = typeof progressionFeatures;
