import { vars } from 'nativewind';
import { type ReactNode, useEffect } from 'react';
import { Platform, View } from 'react-native';

import { useThemeStore } from '@/state/theme-store';
import {
  isThemePaletteId,
  PALETTE_COLOURS,
  type ThemePaletteId,
  varsFor,
} from '@/theme/palettes';

/**
 * THE ONE PALETTE RESOLVER (2026-07-17). Wraps the whole app (inside
 * AuthProvider, around the Stack + ToastHost) and applies the active
 * palette two ways at once:
 *
 * 1. NativeWind `vars()` on this View — every `var(--c-*, fallback)` colour
 *    utility in the compiled CSS resolves through it, so ~850 className
 *    usages (including every already-mounted, idle-preloaded tab screen)
 *    restyle with zero per-component work. 'standard' applies NO vars: the
 *    fallbacks ARE the standard values.
 * 2. Web only: the same custom properties on document.documentElement —
 *    RN-web Modals portal to document.body, OUTSIDE this View, and the
 *    page background behind safe-area insets is the root element's.
 *
 * It also writes the resolved palette into the theme store, which is what
 * useThemeColors() (the inline-read path) serves.
 *
 * Resolution: store preview (the CUSTOMISE screen cycling cards; ownership
 * NOT required — that is the try-before-you-buy feature) beats the equipped
 * palette; anything invalid is standard. The equipped-and-owned path arrives
 * with the loadout's paletteId field (commit D of the palette shop).
 */
function useResolvedPalette(): ThemePaletteId {
  const preview = useThemeStore((s) => s.preview);
  if (isThemePaletteId(preview)) return preview;
  return 'standard';
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const active = useResolvedPalette();
  const setResolved = useThemeStore((s) => s.setResolved);
  useEffect(() => {
    setResolved(active);
  }, [active, setResolved]);

  // The modal/portal + page-background path (web). Clearing before setting
  // makes 'standard' remove every palette property rather than paint over it.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const key of Object.keys(PALETTE_COLOURS.standard)) {
      root.style.removeProperty(`--c-${key}`);
    }
    for (const [key, value] of Object.entries(varsFor(active))) {
      root.style.setProperty(key, value);
    }
  }, [active]);

  return (
    <View
      style={[{ flex: 1, backgroundColor: PALETTE_COLOURS[active].bg }, vars(varsFor(active))]}
    >
      {children}
    </View>
  );
}
