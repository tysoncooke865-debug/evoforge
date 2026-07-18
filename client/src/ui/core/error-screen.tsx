import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import { isChunkLoadError } from '@/domain/chunk-error';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE ERROR SCREEN (2026-07-19). Rendered by the route ErrorBoundaries
 * (app/_layout.tsx + app/(main)/_layout.tsx). Two jobs:
 *
 * 1. A route chunk that failed to load (deploy replaced the hashed files,
 *    or the network dropped) auto-reloads ONCE — the reload fetches the new
 *    shell and the failure heals itself. A localStorage timestamp caps this
 *    to one reload per window (same loop-proof shape as the version guard,
 *    but its own key: this file must not import data/version-guard).
 * 2. Everything else renders a styled RETRY screen — before this existed a
 *    render error inside a lazy route showed the background colour and
 *    nothing else (Tyson: "the screen is all the background colour").
 *
 * No animation on purpose: an error surface must never depend on motion.
 */
const RELOADED_KEY = 'evoforge-chunk-reload-at';
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

function tryAutoReload(): boolean {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return false;
  try {
    const last = Number(localStorage.getItem(RELOADED_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    localStorage.setItem(RELOADED_KEY, String(Date.now()));
    location.reload();
    return true;
  } catch {
    return false;
  }
}

export function ErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const colors = useThemeColors();
  const chunk = isChunkLoadError(String(error?.message ?? ''));

  useEffect(() => {
    if (chunk) tryAutoReload();
  }, [chunk]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        paddingHorizontal: 32,
        backgroundColor: colors.bg,
      }}
      testID="error-screen"
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 24,
          lineHeight: 30,
          color: colors.accent,
          letterSpacing: 1,
          textAlign: 'center',
          textShadowColor: 'rgba(34, 211, 238, 0.45)',
          textShadowRadius: 14,
          ...pixelFont(),
        }}
      >
        {chunk ? 'UPDATING…' : 'SOMETHING BROKE'}
      </Text>
      <Text
        style={{ fontSize: 13, lineHeight: 19, color: colors['text-dim'], textAlign: 'center' }}
      >
        {chunk
          ? 'A new version just shipped — reloading to pick it up.'
          : 'This screen hit an error. Your data is safe — try again.'}
      </Text>
      <NeonButton title="RETRY" pixel onPress={() => void retry()} testID="error-retry" />
    </View>
  );
}
