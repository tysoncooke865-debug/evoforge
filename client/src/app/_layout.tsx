import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthProvider } from '@/data/auth-context';
import { initNavFreezeBeacon, initSceneJanitor, initVersionGuard } from '@/data/version-guard';
import { PIXEL_FONTS } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ThemeRoot } from '@/ui/core/theme-root';
import { ToastHost } from '@/ui/core/toast-host';

import '@/global.css';

/** The persisted-cache key. Purged on sign-out (see auth-context) — the
 *  cache-hygiene invariant: a device must never hand one athlete's
 *  character to the next. */
export const QUERY_CACHE_KEY = 'evoforge-query-cache-v1';

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
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v1' }}
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
  );
}
