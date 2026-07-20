import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';

import { CHUNK_RELOAD_AT_KEY, QUERY_CACHE_KEY, VERSION_GUARD_AT_KEY } from '@/data/cache-keys';
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
 * THE ESCAPE HATCH (2026-07-20, the lockout postmortem): RETRY only
 * re-renders, so a crash driven by POISONED PERSISTED DATA (the query cache
 * in localStorage, which hard refresh does not clear) recurred forever —
 * and the boot overlay's nuclear reset never showed because the app HAD
 * booted before the route threw. CLEAR CACHE & RELOAD removes exactly the
 * refetchable device caches — the persisted query cache plus both
 * reload-guard timestamps (re-arming the auto-heals) — and reloads. It
 * NEVER touches the auth session (no forced sign-out) or the zustand
 * stores/queues holding unsynced athlete work; the nuclear
 * localStorage.clear() remains exclusive to the +html.tsx boot overlay.
 *
 * No animation on purpose: an error surface must never depend on motion.
 * Imports stay ui/theme/domain/cache-keys only — this screen must render
 * while app-layer modules are broken.
 */
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

function tryAutoReload(): boolean {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return false;
  try {
    const last = Number(localStorage.getItem(CHUNK_RELOAD_AT_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    localStorage.setItem(CHUNK_RELOAD_AT_KEY, String(Date.now()));
    location.reload();
    return true;
  } catch {
    return false;
  }
}

function clearCachesAndReload(): void {
  // Raw localStorage on purpose: AsyncStorage's web backend IS localStorage
  // with unprefixed keys (auth-context removes the same key both ways), it is
  // synchronous before the reload, and it keeps this file dependency-light.
  try {
    localStorage.removeItem(QUERY_CACHE_KEY);
    localStorage.removeItem(CHUNK_RELOAD_AT_KEY); // re-arm the chunk auto-reload
    localStorage.removeItem(VERSION_GUARD_AT_KEY); // re-arm the version guard
  } catch {
    // storage blocked — reload anyway
  }
  location.reload();
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
      {Platform.OS === 'web' ? (
        <NeonButton
          title="CLEAR CACHE & RELOAD"
          variant="ghost"
          pixel
          onPress={clearCachesAndReload}
          testID="error-clear-cache"
        />
      ) : null}
    </View>
  );
}
