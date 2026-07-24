/**
 * Arena 2.0 rollout flags (Redesign P0). A data-driven registry that replaces
 * the single legacy `arenaGameEnabled` bool (features.ts) as the way new Arena
 * 2.0 systems are gated. Each system ships behind its OWN flag so the landscape
 * rebuild can be enabled incrementally and rolled back instantly by flipping a
 * value — no logic redeploy, no data loss (see ARENA_2.0_REDESIGN.md §14).
 *
 * Frozen so nothing mutates flags at runtime. Today every gameplay flag is OFF:
 * Arena 1.0 (portrait) is untouched and remains the live experience; only the
 * dev-only Anim Lab is on so P0 is demonstrable without changing any battle.
 */
export const arena2Flags = Object.freeze({
  /** P0 — the dev-only AutoSprite Anim Lab scratch screen (128px champion demo). */
  animLab: true,
  /** P5 — allow 128px atlas-backed champions in real battles (sim-driven clips). */
  autoSpriteChampions: true,
  /** P1 — landscape battlefield + follow-camera renderer. */
  arena2Renderer: false,
  /** P2 — manual champion control (basic/combo/lane-switch commands). */
  championControl: false,
  /** P3 — real simulation-level formation (spacing / melee slots / standoff). */
  formationSim: true,
  /** P6 — real seasonal ranked ladder (needs the farm-proof server rule). */
  rankedLadder: false,
});

export type Arena2Flag = keyof typeof arena2Flags;

/** Whether an Arena 2.0 system is enabled. Single read point so a future
 *  remote/config-driven source can replace the frozen literal without callers
 *  changing. */
export function arena2FlagEnabled(flag: Arena2Flag): boolean {
  return arena2Flags[flag];
}
