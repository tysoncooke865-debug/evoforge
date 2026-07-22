/**
 * Single owner of the player's SaveData at runtime. Implemented as a vanilla
 * zustand store so it works headless in tests; React screens subscribe via
 * the hook exported from src/features (later milestones) or useStore.
 */
import { createStore } from 'zustand/vanilla';
import {
  createDefaultSave,
  loadSave,
  persistSave,
  resetSave,
  SaveData,
} from '../persistence/save';
import type { KeyValueStorage } from '../persistence/storage';

export interface PlayerStoreState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  save: SaveData;
  /** True if the last load had to recover from corrupt data. */
  recovered: boolean;
  /** True if this is a fresh install (no prior save). */
  fresh: boolean;
  error: string | null;

  initialize(storage: KeyValueStorage): Promise<void>;
  /** Apply a mutation to the save and persist it. */
  update(mutator: (save: SaveData) => SaveData): Promise<void>;
  reset(): Promise<void>;
}

export function createPlayerStore(storageRef: { current: KeyValueStorage | null }) {
  return createStore<PlayerStoreState>((set, get) => ({
    status: 'idle',
    save: createDefaultSave(),
    recovered: false,
    fresh: false,
    error: null,

    async initialize(storage: KeyValueStorage) {
      storageRef.current = storage;
      set({ status: 'loading', error: null });
      const result = await loadSave(storage);
      if (result.fresh) {
        // Persist immediately so a first-session crash still leaves a valid save.
        await persistSave(storage, result.save);
      }
      set({
        status: 'ready',
        save: result.save,
        recovered: result.recovered,
        fresh: result.fresh,
      });
    },

    async update(mutator) {
      const { save, status } = get();
      if (status !== 'ready') throw new Error('player store not initialized');
      const storage = storageRef.current;
      if (!storage) throw new Error('player store has no storage backend');
      const next = mutator(save);
      set({ save: next });
      await persistSave(storage, next);
    },

    async reset() {
      const storage = storageRef.current;
      if (!storage) throw new Error('player store has no storage backend');
      const fresh = await resetSave(storage);
      set({ save: fresh, recovered: false, fresh: true, status: 'ready' });
    },
  }));
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;
