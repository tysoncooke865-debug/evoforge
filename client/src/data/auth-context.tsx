import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
    useToastStore.getState().reset();
  };

  return <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
