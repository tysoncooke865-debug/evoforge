import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ONLINE PRESENCE (Tyson, 2026-07-20) — a live count of players currently in the
 * app, via Supabase Realtime Presence. Every signed-in client joins ONE global
 * channel keyed by user id; the presence state's key count = unique players
 * online (multiple tabs collapse to one). Reconnect-safe: presence rebuilds on
 * every sync, and leaving the app untracks automatically.
 *
 * ── TRAINING NOW (2026-08-08, for LIVE WORKOUT CALL OUTS) ──
 *
 * The same channel carries one extra bit: is this athlete inside a workout right
 * now. It rides here rather than in a new table because presence is already
 * exactly the right shape — ephemeral, reconnect-safe, and gone the moment the
 * app closes. A `last_seen_at` column would have to be written, polled and
 * cleaned up, and would still be wrong the instant somebody's phone died.
 *
 * WHAT IS DELIBERATELY NOT BROADCAST: the workout's NAME. This channel is every
 * signed-in athlete, not just friends, so anything put in the payload is public
 * to the whole app. "JESSE ● TRAINING NOW · 34 MIN" needs a boolean and a
 * timestamp, and telling four thousand strangers that somebody is doing legs
 * buys nothing. `useTrainingFriends` intersects the payload with the caller's
 * own friend list, so only a friend is ever SHOWN — but the fence that matters
 * is the one on what gets sent.
 */

interface OnlineStore {
  count: number;
  /** userId → when they started their current workout (ISO). Friends are
   *  filtered at the read site; this map is whatever the channel reported. */
  training: Readonly<Record<string, string>>;
  setCount: (n: number) => void;
  setTraining: (t: Record<string, string>) => void;
}
const useOnlineStore = create<OnlineStore>((set) => ({
  count: 0,
  training: {},
  setCount: (count) => set({ count }),
  setTraining: (training) => set({ training }),
}));

/** MY workout, if I am in one. Written by the workout page, read by the
 *  presence mount at the app root — the two are on different screens, and a
 *  tiny store is how they meet without prop-drilling through the router. */
interface MyTrainingStore {
  since: string | null;
  setSince: (iso: string | null) => void;
}
const useMyTraining = create<MyTrainingStore>((set) => ({
  since: null,
  setSince: (since) => set({ since }),
}));

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
  const since = useMyTraining((s) => s.since);

  useEffect(() => {
    if (!userId) {
      useOnlineStore.getState().setCount(0);
      useOnlineStore.getState().setTraining({});
      return;
    }
    const channel = supabase.channel('presence:online', { config: { presence: { key: userId } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, { training?: boolean; since?: string }[]>;
      useOnlineStore.getState().setCount(Object.keys(state).length);
      const training: Record<string, string> = {};
      for (const [key, metas] of Object.entries(state)) {
        // Multiple tabs collapse to one athlete: any tab that says "training"
        // makes them training, and the earliest start is the honest one.
        for (const meta of metas ?? []) {
          if (meta?.training && typeof meta.since === 'string') {
            training[key] = training[key] && training[key] < meta.since ? training[key] : meta.since;
          }
        }
      }
      useOnlineStore.getState().setTraining(training);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({
          online_at: new Date().toISOString(),
          training: useMyTraining.getState().since !== null,
          since: useMyTraining.getState().since,
        });
      }
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Re-track when the athlete opens or leaves a workout. A separate effect
  // because re-subscribing the whole channel to change one boolean would drop
  // and rebuild every other client's view of this athlete.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.getChannels().find((c) => c.topic === 'realtime:presence:online');
    if (!channel) return;
    void channel.track({
      online_at: new Date().toISOString(),
      training: since !== null,
      since,
    });
  }, [userId, since]);
}

/**
 * DECLARE THAT I AM TRAINING, for as long as this screen is mounted.
 *
 * Mounted by the workout page. Unmounting clears it, and so does closing the
 * app — which is the behaviour that makes a presence flag trustworthy: it can
 * only ever be wrong in the direction of saying LESS than the truth.
 */
export function useTrainingPresence(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const since = new Date().toISOString();
    useMyTraining.getState().setSince(since);
    return () => {
      useMyTraining.getState().setSince(null);
    };
  }, [active]);
}

/** A minute clock. `ui/duel/duel-hud` has the same six lines; duplicating them
 *  is cheaper than making `data/` import from `ui/`, which would invert the
 *  layering this codebase keeps clean everywhere else. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface TrainingNow {
  userId: string;
  /** Whole minutes since they started. Null when the clock reads nonsense. */
  minutes: number | null;
}

/**
 * WHICH OF THESE ATHLETES IS IN A WORKOUT RIGHT NOW.
 *
 * Pass the friend ids; get back the ones training. The caller supplies the
 * list, so this hook can never widen who is visible — and the payload it reads
 * carries no workout, no exercise and no numbers.
 */
export function useTrainingFriends(friendIds: readonly string[]): TrainingNow[] {
  const training = useOnlineStore((s) => s.training);
  // A ticking clock, not a bare Date.now(): reading the wall clock during
  // render is impure, and "34 MIN" genuinely has to climb while the tray is
  // open. One minute is the resolution the label shows anyway.
  const now = useNow(60_000);
  const out: TrainingNow[] = [];
  for (const id of friendIds) {
    const since = training[id];
    if (!since) continue;
    const started = Date.parse(since);
    const minutes = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 60_000)) : null;
    out.push({ userId: id, minutes });
  }
  return out;
}

/** Reset on sign-out, like every store. */
export function resetPresence(): void {
  useOnlineStore.getState().setCount(0);
  useOnlineStore.getState().setTraining({});
  useMyTraining.getState().setSince(null);
}
