import { create } from 'zustand';

import type { ThemePaletteId } from '@/theme/palettes';

/**
 * THE ACTIVE PALETTE (2026-07-17). In-memory only, NOT persisted — the
 * EQUIPPED palette persists as loadout.paletteId in loadout-store, and
 * ownership is server truth (user_palette_unlocks). This store carries:
 *
 * - `preview`: the palette the CUSTOMISE screen is showing while the athlete
 *   cycles store cards. Focus-scoped by the screen (set on focus/selection,
 *   cleared on blur), ownership NOT required — that is the live-preview
 *   feature. Anything invalid resolves as standard.
 * - `resolved`: what the app is actually wearing right now. Written ONLY by
 *   ThemeRoot (the single resolver: preview ?? equipped-and-owned ??
 *   standard); read by useThemeColors() everywhere.
 *
 * DOCTRINE: reset on sign-out in auth-context like every store. Nothing is
 * persisted here, so reset() is the whole teardown.
 */
interface ThemeState {
  preview: string | null;
  resolved: ThemePaletteId;
  setPreview: (id: string | null) => void;
  setResolved: (id: ThemePaletteId) => void;
  reset: () => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  preview: null,
  resolved: 'standard',
  setPreview: (preview) => set({ preview }),
  setResolved: (resolved) => set({ resolved }),
  reset: () => set({ preview: null, resolved: 'standard' }),
}));
