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
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Same convention as session-store: flip the flag on the rehydrated
        // draft so readers can tell "default" from "not yet loaded".
        state._hydrated = true;
      },
    }
  )
);
