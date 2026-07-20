import { useEffect } from 'react';
import { create } from 'zustand';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ONLINE PRESENCE (Tyson, 2026-07-20) — a live count of players currently in the
 * app, via Supabase Realtime Presence. Every signed-in client joins ONE global
 * channel keyed by user id; the presence state's key count = unique players
 * online (multiple tabs collapse to one). Reconnect-safe: presence rebuilds on
 * every sync, and leaving the app untracks automatically.
 */

interface OnlineStore {
  count: number;
  setCount: (n: number) => void;
}
const useOnlineStore = create<OnlineStore>((set) => ({ count: 0, setCount: (count) => set({ count }) }));

/** The live number of players online (includes you). */
export function useOnlineCount(): number {
  return useOnlineStore((s) => s.count);
}

/**
 * Join the global presence channel and keep the count in sync. Mount ONCE, at
 * the authenticated app root — so a player is counted for as long as the app is
 * open, on any screen, not only while viewing the count.
 */
export function useOnlinePresence(): void {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      useOnlineStore.getState().setCount(0);
      return;
    }
    const channel = supabase.channel('presence:online', { config: { presence: { key: userId } } });
    channel.on('presence', { event: 'sync' }, () => {
      useOnlineStore.getState().setCount(Object.keys(channel.presenceState()).length);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ online_at: new Date().toISOString() });
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
