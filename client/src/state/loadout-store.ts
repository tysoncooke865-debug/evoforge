import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_LOADOUT, type Loadout } from '@/domain/customise';

/**
 * The EQUIPPED loadout (Tyson, 2026-07-16): what the CUSTOMISE screen's
 * EQUIP button saves — character line, evolution stage, skin, aura, emote,
 * effect. PERSISTED (AsyncStorage → localStorage on web) so the choice
 * survives restarts. It stores PREFERENCES ONLY — display resolution
 * re-validates every field against live progression on read
 * (domain/customise resolveDisplay), so a stale loadout can never render
 * a form or cosmetic whose gates have closed.
 *
 * DOCTRINE: cleared on sign-out in auth-context, like every store — the
 * persisted layer too (a shared device must not dress the next athlete
 * in the last one's skin).
 */
interface LoadoutState {
  loadout: Loadout;
  _hydrated: boolean;
  equip: (loadout: Loadout) => void;
  reset: () => void;
}

export const useLoadoutStore = create<LoadoutState>()(
  persist(
    (set) => ({
      loadout: DEFAULT_LOADOUT,
      _hydrated: false,
      equip: (loadout) => set({ loadout }),
      reset: () => set({ loadout: DEFAULT_LOADOUT }),
    }),
    {
      name: 'evoforge-loadout',
      storage: createJSONStorage(() => AsyncStorage),
      // MIGRATION (Tyson, 2026-07-16: "app crashes on Customise"): a loadout
      // persisted before a field existed (e.g. the Gymerica overlay fields)
      // rehydrates WITHOUT it — `character` comes back undefined, not null,
      // which is truthy-different-from-null and tripped Gymerica mode into a
      // crash. Merging DEFAULT_LOADOUT under the saved values fills every
      // missing field, so an old wallet is always a complete loadout.
      merge: (persisted, current) => {
        const saved = (persisted as { loadout?: Partial<Loadout> } | undefined)?.loadout;
        return { ...current, loadout: { ...DEFAULT_LOADOUT, ...(saved ?? {}) } };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Same convention as session-store: flip the flag on the rehydrated
        // draft so readers can tell "default" from "not yet loaded".
        state._hydrated = true;
      },
    }
  )
);
