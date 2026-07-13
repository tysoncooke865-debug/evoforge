import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { AuthProvider } from '@/data/auth-context';
import { ToastHost } from '@/ui/toast-host';

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
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: AsyncStorage, key: QUERY_CACHE_KEY, throttleTime: 2000 })
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v1' }}
    >
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#070b14' }, // --bg, behind route transitions
          }}
        />
        <ToastHost />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
