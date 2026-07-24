import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { AuthContext, useAuth } from '@/data/auth-context';
import { pixelFont } from '@/theme/fonts';

import { seedLabCache } from './fixtures';
import { LAB_SESSION } from './lab-user';
import type { LabDataMode } from './types';

/**
 * The lab's data seam — one provider, two modes:
 *
 * REAL: children render bare. Root QueryClient, real auth, real Zustand —
 * a real-mode lab workout IS a real workout (that is the point; use the
 * smoke accounts, HANDOVER §5). Signed out, hooks are disabled and screens
 * sit on their honest empty states.
 *
 * MOCK: a fresh QueryClient pre-seeded at every key the screens read
 * (staleTime Infinity — the queryFn never fires), under a fake session so
 * hooks resolve userId = LAB_USER_ID. Fully interactive with zero network —
 * PROVIDED the variant's writes go through lab/mock/mutations.ts. Writes
 * that don't are still real writes; the banner below says so whenever a
 * real signed-in session exists underneath.
 *
 * NOT isolated in either mode: the Zustand stores (session-store's
 * skips/ad-hoc, rest timer, toasts). Documented in src/lab/README.md.
 */

const LabDataContext = createContext<LabDataMode>('real');

/** Which mode the enclosing lab host mounted — 'real' outside the lab. */
export function useLabDataMode(): LabDataMode {
  return useContext(LabDataContext);
}

export function LabDataProvider({ mode, children }: { mode: LabDataMode; children: ReactNode }) {
  if (mode === 'real') {
    return <LabDataContext.Provider value="real">{children}</LabDataContext.Provider>;
  }
  return <MockProviders>{children}</MockProviders>;
}

function MockProviders({ children }: { children: ReactNode }) {
  const real = useAuth();
  // useState, not module scope — one seeded client per mount, same doctrine
  // as RootLayout's. The host keys this provider by mode, so toggling
  // REAL ⇄ MOCK remounts and reseeds from scratch.
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
    <LabDataContext.Provider value="mock">
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
    </LabDataContext.Provider>
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
