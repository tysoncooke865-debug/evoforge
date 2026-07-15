import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AuthProvider } from '@/data/auth-context';
import { PIXEL_FONTS } from '@/theme/fonts';
import { ToastHost } from '@/ui/core/toast-host';

import '@/global.css';

/** The persisted-cache key. Purged on sign-out (see auth-context) — the
 *  cache-hygiene invariant: a device must never hand one athlete's
 *  character to the next. */
export const QUERY_CACHE_KEY = 'evoforge-query-cache-v1';

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
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: AsyncStorage, key: QUERY_CACHE_KEY, throttleTime: 2000 })
  );

  // OPTIMISE_PLAN M3 — the boot moment: one cross-fade from the stage
  // colour on first mount. One-shot, never blocks interaction, and reduced
  // motion snaps straight to visible.
  const reducedMotion = useReducedMotion();
  const boot = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    boot.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bootStyle = useAnimatedStyle(() => ({ opacity: boot.value }));

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v1' }}
    >
      <AuthProvider>
        <Animated.View style={[{ flex: 1, backgroundColor: '#070b14' }, bootStyle]}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#070b14' }, // --bg, behind route transitions
            }}
          />
        </Animated.View>
        <ToastHost />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
