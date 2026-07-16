/**
 * PROGRESSION_OVERHAUL — current / starting / peak state (spec §14), as a
 * pure reducer over confirmed review results. Peak never decreases;
 * starting never changes after first confirmation; lifetime evolution is
 * always current − starting.
 */

import { deriveEvoDisplay } from './evo-rating';

export interface EvoState {
  currentRaw: number;
  currentDisplayed: number;
  evolutionProgress: number;
  startingRaw: number;
  startingDisplayed: number;
  peakRaw: number;
  peakDisplayed: number;
  lifetimeEvolution: number;
}

/** First confirmed rating: everything anchors here. */
export function initialEvoState(raw: number): EvoState {
  const { displayedRating, evolutionProgress } = deriveEvoDisplay(raw);
  return {
    currentRaw: raw,
    currentDisplayed: displayedRating,
    evolutionProgress,
    startingRaw: raw,
    startingDisplayed: displayedRating,
    peakRaw: raw,
    peakDisplayed: displayedRating,
    lifetimeEvolution: 0,
  };
}

/** A confirmed review lands: current moves, PEAK ONLY RATCHETS UP. */
export function applyConfirmedRating(state: EvoState, newRaw: number): EvoState {
  const { displayedRating, evolutionProgress } = deriveEvoDisplay(newRaw);
  const peakRaw = Math.max(state.peakRaw, newRaw);
  return {
    ...state,
    currentRaw: newRaw,
    currentDisplayed: displayedRating,
    evolutionProgress,
    peakRaw,
    peakDisplayed: Math.max(state.peakDisplayed, displayedRating),
    lifetimeEvolution: displayedRating - state.startingDisplayed,
  };
}

/** Hundredths of progress needed to reclaim a lost peak (spec §14/§17). */
export function reclaimProgress(state: EvoState): number | null {
  if (state.currentRaw >= state.peakRaw) return null;
  return Math.max(1, Math.round((state.peakRaw - state.currentRaw) * 100));
}
