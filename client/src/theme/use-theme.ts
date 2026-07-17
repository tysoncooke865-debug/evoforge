import { useThemeStore } from '@/state/theme-store';
import { PALETTE_COLOURS, type PaletteColours, type ThemePaletteId } from '@/theme/palettes';

/**
 * The render-time colour source (2026-07-17). Components that used to read
 * `tokens.colors.x` inline read `useThemeColors().x` instead, so an equipped
 * (or store-previewed) palette recolours them live. Values are REAL hex/rgba
 * strings — LinearGradient props, Reanimated interpolations, SVG fills and
 * the `${colour}b3` alpha-suffix idiom all keep working unchanged.
 *
 * Cost: one zustand subscription per component returning a module-scope
 * precomputed record (stable reference per palette — React-Compiler
 * friendly). The className path doesn't need this hook at all: those
 * utilities resolve through `var(--c-*, fallback)` set by ThemeRoot.
 */
export function useThemeColors(): PaletteColours {
  return PALETTE_COLOURS[useThemeStore((s) => s.resolved)];
}

/** The palette the app is currently wearing (preview included). */
export function useActivePaletteId(): ThemePaletteId {
  return useThemeStore((s) => s.resolved);
}
