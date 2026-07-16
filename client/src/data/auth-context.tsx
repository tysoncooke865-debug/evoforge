import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useSessionStore } from '@/state/session-store';
import { useLoadoutStore } from '@/state/loadout-store';
import { useSettingsStore } from '@/state/settings-store';
import { useToastStore } from '@/state/toast-store';

import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  /** true until the persisted session (if any) has been restored. */
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Sign-out clears every cache layer, not just the token. The Streamlit app
  // had four caches and the rule that missing one on sign-out hands the last
  // athlete's character to the next visitor (root CLAUDE.md). Here: TanStack
  // Query + every Zustand store. Add a store, clear it here, same rule.
  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    void import('./set-queue').then(({ clearSetQueue }) => clearSetQueue().catch(() => undefined));
    // A pending FINISH belongs to the athlete who signed out (the
    // every-cache-layer doctrine — add a store, clear it here).
    void import('./finish-queue').then(({ clearFinishQueue }) =>
      clearFinishQueue().catch(() => undefined)
    );
    // TRANSFORM P1: the PERSISTED query cache must die with the session —
    // same invariant as the in-memory clear (never hand the last athlete's
    // character to the next visitor on a shared device).
    void import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
      AsyncStorage.removeItem('evoforge-query-cache-v1').catch(() => undefined)
    );
    useToastStore.getState().reset();
    useSettingsStore.getState().reset();
    // Stage 1: today's skips/adds/ad-hoc workout belong to the athlete who
    // signed out. It is PERSISTED, so clearing the in-memory store is not
    // enough — the persisted copy must go too, or the next athlete on this
    // device inherits yesterday's deviations.
    useSessionStore.getState().reset();
    void import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
      AsyncStorage.removeItem('evoforge-session-v1').catch(() => undefined)
    );
    // The equipped loadout (skin/aura/emote/stage) is PERSISTED too — the
    // next athlete on this device must not wear the last one's costume.
    useLoadoutStore.getState().reset();
    void import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
      AsyncStorage.removeItem('evoforge-loadout').catch(() => undefined)
    );
  };

  return <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
