/**
 * React bindings for the player store (app side).
 */
import { useStore } from 'zustand';
import { playerStore } from '../app-services';
import type { PlayerStoreState } from './player-store';

export function usePlayer<T>(selector: (state: PlayerStoreState) => T): T {
  return useStore(playerStore, selector);
}
