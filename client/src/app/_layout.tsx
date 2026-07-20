import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider } from '@/data/auth-context';
import { QUERY_CACHE_KEY } from '@/data/cache-keys';
import { initNavFreezeBeacon, initSceneJanitor, initVersionGuard } from '@/data/version-guard';
import { runningBuildId } from '@/domain/build-id';
import { PIXEL_FONTS } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ThemeRoot } from '@/ui/core/theme-root';
import { ToastHost } from '@/ui/core/toast-host';

import '@/global.css';

// The persisted-cache key lives in data/cache-keys.ts (single source of
// truth for sign-out, the error screen's CLEAR CACHE, and the persister).

/** Route-error surface (2026-07-19): expo-router renders this named export
 *  when any route below throws. Before it existed, a throw inside a lazy
 *  route left the bare background colour on screen. The (main) layout
 *  exports its own copy so recovery keeps the auth providers mounted. */
export { ErrorBoundary } from '@/ui/core/route-error-boundary';

/** The Stack needs the ACTIVE palette's bg behind route transitions, so it
 *  reads the theme hook — its own component keeps RootLayout's providers
 *  above the subscription. */
function ThemedStack() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg }, // --bg, behind route transitions
      }}
    />
  );
}

export default function RootLayout() {
  // useState, not module scope: one QueryClient per app instance, never shared
  // across static-render passes. Per-user isolation inside it is by auth state
  // (RLS on the server is the real guard; the client cache is cleared on
  // sign-out in auth-context, and the PERSISTED copy is purged there too).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // TRANSFORM P1: cached-first rendering. Stale data still PAINTS
            // immediately while a background refetch runs, so Home/Train are
            // usable before Supabase answers (a cold start previously
            // rendered defaults until the network came back).
            gcTime: 24 * 60 * 60 * 1000,
            // AUDIT B2 (2026-07-19): with six tabs mounted, staleTime 0 made
            // EVERY query refetch on EVERY window refocus — a storm that also
            // re-ran the heavy per-render derivations. 45s keeps refocus
            // instant from cache; every mutation invalidates its readers
            // (keys.ts), so writes still repaint immediately. Hooks needing
            // faster/slower freshness keep their own staleTime overrides.
            staleTime: 45_000,
          },
        },
      })
  );
  // The pixel display face (Pixelify Sans). No splash gate: the system font
  // paints first and swaps in — a font must never block the app.
  useFonts(PIXEL_FONTS);
  // Stale-shell guard: one-shot per app instance (see data/version-guard.ts).
  useEffect(() => {
    initVersionGuard();
    initNavFreezeBeacon();
    initSceneJanitor();
  }, []);
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: AsyncStorage, key: QUERY_CACHE_KEY, throttleTime: 2000 })
  );
  // THE LOCKOUT FIX (2026-07-20): the buster is the DEPLOYED BUILD's entry
  // hash, so a new deploy discards the persisted cache exactly once at
  // restore. A static buster let an old bundle's normalized objects
  // rehydrate into a new bundle whose render assumed newer fields
  // (post.tagged) — a permanent, hard-refresh-proof crash, because
  // localStorage survives refresh and RETRY re-read the same bytes.
  const [buster] = useState(() => runningBuildId());

  // BOOT SIGNAL: tell the +html.tsx safety-net script that the React app
  // successfully mounted. Expo statically pre-renders each route into #root, so
  // "is the root empty" can never detect a failed boot — this flag can. If the
  // JS bundle 404s or throws before mount, this never runs and the overlay
  // shows the error; if it runs (even late), the overlay auto-dismisses.
  useEffect(() => {
    (globalThis as { __EVO_BOOTED?: boolean }).__EVO_BOOTED = true;
  }, []);

  // The boot cross-fade (OPTIMISE_PLAN M3) is now PURE CSS on #root — see
  // +html.tsx. It used to be a Reanimated shared value that started the whole
  // app at opacity 0 and animated to 1 via requestAnimationFrame; in a cold
  // iOS standalone PWA that frame could fail to tick, stranding the app
  // INVISIBLE over the #070b14 boot colour (Tyson, 2026-07-16: "stuck on a
  // blue/grey blank screen" — home-screen only, web was fine). Visibility must
  // never depend on an animation firing; the CSS fade rests at opacity 1 and
  // is skipped entirely under reduced motion.
  return (
    // GestureHandlerRootView (2026-07-19): required for drag-to-reorder
    // (react-native-gesture-handler) to receive pointer/touch events — on web
    // it also sets touch-action on detectors so a drag never scrolls the page.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster }}
      >
        <AuthProvider>
          {/* ThemeRoot applies the equipped/previewed palette (CSS vars +
              themed background); its View replaces the old hardcoded #070b14
              wrapper. ToastHost rides inside so toasts theme too. */}
          <ThemeRoot>
            <ThemedStack />
            <ToastHost />
          </ThemeRoot>
        </AuthProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
