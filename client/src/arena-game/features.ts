/**
 * Feature flags for the Arena card-battler mini-game (mirrors the
 * progressionFeatures pattern: a frozen object, flipped only when the thing
 * behind the flag is genuinely shipped).
 */
export const arenaGameFeatures = Object.freeze({
  /** The EvoForge Arena card-battler beta (route group /forge-arena). */
  arenaGameEnabled: true,
});
