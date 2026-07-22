/**
 * React bindings for the battle store (app side).
 */
import { useStore } from 'zustand';
import { battleStore } from './battle-store';
import type { BattleStoreState } from './battle-store';

export function useBattle<T>(selector: (state: BattleStoreState) => T): T {
  return useStore(battleStore, selector);
}
