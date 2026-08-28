import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { AuthContext, useAuth } from '@/data/auth-context';
import { pixelFont } from '@/theme/fonts';

import { seedLabCache } from './fixtures';
import { LAB_SESSION } from './lab-user';

/**
 * The lab's data seam — MOCK, and only mock.
 *
 * A fresh QueryClient pre-seeded at every key the screens read (staleTime
 * Infinity — the queryFn never fires), under a fake session so hooks resolve
 * userId = LAB_USER_ID. Fully interactive with zero network — PROVIDED the
 * variant's writes go through lab/mock/mutations.ts.
 *
 * There used to be a REAL mode that rendered children bare on the app's own
 * providers. It is gone: signed out it showed empty states nobody can judge a
 * design by, and signed in a lab workout was a real workout on a real account.
 *
 * THE HARD TRUTH, unchanged by that removal: faking the auth CONTEXT does not
 * make writes safe. The supabase client is a module singleton holding its own
 * session — a write this file has not shimmed still goes out over the real
 * client with the real JWT (or strands junk in the durable AsyncStorage
 * set-queue when signed out). Only the eight paths in mock/mutations.ts are
 * intercepted. The banner below says so whenever a real session exists
 * underneath the fake one, which is exactly when it can bite.
 *
 * NOT isolated: the Zustand stores (session-store's skips/ad-hoc, rest timer,
 * toasts). Documented in src/lab/README.md.
 */
export function LabDataProvider({ children }: { children: ReactNode }) {
  const real = useAuth();
  // useState, not module scope — one seeded client per mount, same doctrine
  // as RootLayout's. The host keys this provider by page/variant, so every
  // variant swap remounts and reseeds from scratch.
  const [client] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      },
    });
    seedLabCache(qc);
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={{ session: LAB_SESSION, loading: false, signOut: async () => {} }}
      >
        <View style={{ flex: 1 }}>
          {real.session ? <MockWriteWarning /> : null}
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

/** Mock reads are seeded, but a write path a variant has NOT shimmed still
 *  goes through the real Supabase client — and with a real session under
 *  this fake one, that lands on the signed-in account. Say so, always. */
function MockWriteWarning() {
  return (
    <View
      style={{
        backgroundColor: '#7c2d12',
        borderBottomWidth: 1,
        borderBottomColor: '#fb923c',
        paddingVertical: 6,
        paddingHorizontal: 12,
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ color: '#fdba74', fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        MOCK READS ONLY — un-shimmed writes go to the signed-in account. Sign out or use a smoke
        account.
      </Text>
    </View>
  );
}
