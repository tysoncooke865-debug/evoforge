import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';

import {
  DEFAULT_DROP_TIERS,
  tierForRating,
  type DropResult,
  type DropTier,
} from '@/domain/forge-drop';
import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * FORGE DROP — the client's side of migrations 154/155.
 *
 * THE BALANCE IS NEVER INVENTED HERE. Every settlement returns the server's own
 * `coin_total()`, and that is the number the screen shows; nothing is applied
 * optimistically, because a balance that moves before the ledger does is a
 * balance that can be wrong. The wallet on Home, Customise, the Vault and this
 * screen all read the same `['coin_total']` key, so they reconcile the moment
 * a drop settles.
 */

const TIERS_KEY = 'forge_drop_tiers';
const HISTORY_KEY = 'forge_drop_history';
/** The in-flight wager's key, on disk. See `useRecoverDrop`. */
const PENDING_KEY = 'evoforge-forge-drop-pending-v1';

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** Everything a settled drop changes. One function, so a pot can never
 *  disagree with a wallet on the same screen. */
export function refreshDrop(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
  invalidateTable(queryClient, 'coin_events');
  void queryClient.invalidateQueries({ queryKey: [HISTORY_KEY, userId] });
}

// ─────────────────────────────────────────────────────────────── the board

export function useDropTiers() {
  return useQuery({
    queryKey: [TIERS_KEY],
    // The board moves by SQL, not by deploy, but it does not move often.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DropTier[]> => {
      const { data, error } = await supabase.rpc('forge_drop_settings');
      if (error || !data || (data as unknown[]).length === 0) return DEFAULT_DROP_TIERS;
      return (data as DropTier[]).map((t) => ({
        ...t,
        // Postgres numerics arrive as strings through PostgREST. A multiplier
        // that stayed a string would concatenate instead of multiply, and the
        // payout table would read "51.35" rather than a number.
        multipliers: (t.multipliers as unknown as (string | number)[]).map(Number),
        target_rtp: Number(t.target_rtp),
      }));
    },
  });
}

/**
 * WHICH BOARD THIS ATHLETE IS ON.
 *
 * Mirrors `forge_drop_tier_for` so the screen can be drawn before a drop is
 * played — but it is NOT the authority. The server reads the same rating and
 * decides for itself, and a mismatch shows up as a refused stake rather than a
 * wrong payout. `ready` is false until both reads have landed, so the board is
 * never drawn at the wrong tier and then corrected under the athlete.
 */
/**
 * THE RATING, READ FRESH.
 *
 * Deliberately NOT `useEvoRatingCurrent`. That shares the app's global
 * `staleTime: 45_000` and a 24-hour persisted cache, which is right for a
 * dashboard and wrong for the number that decides a stake ceiling: the browser
 * tour caught the board still showing CYBER FOUNDRY after the rating had moved
 * to tier 1 and tier 5.
 *
 * Same query KEY, so there is still one cached row and every other screen picks
 * up whatever this refetches — only the freshness policy differs.
 *
 * The server re-reads the rating for itself regardless, so a stale client could
 * only ever draw the wrong board and then have its stake refused. Drawing the
 * wrong board is bad enough.
 */
function useFreshRating() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['evo_rating_current', userId],
    enabled: userId !== null,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('evo_rating_current').select('*').limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useMyDropTier(): {
  tier: DropTier;
  rating: number | null;
  ready: boolean;
  missingRating: boolean;
} {
  const evo = useFreshRating();
  const tiers = useDropTiers();
  const rating = (evo.data as { displayed_rating?: number } | null)?.displayed_rating ?? null;
  return {
    tier: tierForRating(rating, tiers.data ?? DEFAULT_DROP_TIERS),
    rating,
    ready: !evo.isPending && !tiers.isPending,
    // Not an error — the lowest board is the honest answer for somebody no
    // review has rated yet — but the screen says so rather than implying they
    // have been assessed and placed at the bottom.
    missingRating: !evo.isPending && rating === null,
  };
}

export function useDropHistory(limit = 12) {
  const userId = useUserId();
  return useQuery({
    queryKey: [HISTORY_KEY, userId, limit],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_forge_drops', { p_limit: limit });
      if (error) {
        if (/does not exist|schema cache|PGRST202|PGRST205/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as { id: string; tier: number; stake: number; payout: number; net: number }[];
    },
  });
}

// ────────────────────────────────────────────────────────────── the wager

function humanise(message: string): string {
  const m = message.replace(/^[a-z_]+:\s*/i, '').trim();
  if (/row-level security/i.test(message)) return 'That is not yours to play.';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export interface PlayInput {
  stake: number;
  lane: number;
  /** Minted by the caller BEFORE the request, and kept if it has to be
   *  retried. Sending a fresh key on a retry would be a second wager. */
  key: string;
}

/**
 * PLAY ONE DROP.
 *
 * The key is minted by the screen and written to disk before this is called, so
 * that a refresh, a crash or a dead tunnel mid-flight leaves something to ask
 * about rather than a wager nobody can account for. `useRecoverDrop` does the
 * asking.
 */
export function usePlayDrop() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({ stake, lane, key }: PlayInput): Promise<DropResult> => {
      const { data, error } = await supabase.rpc('forge_drop_play', {
        p_key: key,
        p_stake: stake,
        p_lane: lane,
      });
      if (error) throw new Error(humanise(error.message));
      const r = data as DropResult & { multiplier: string | number; path: number[] };
      return { ...r, multiplier: Number(r.multiplier), path: (r.path ?? []).map(Number) };
    },
    onSuccess: (result) => {
      refreshDrop(queryClient, userId);
      track('forge_drop_settled', {
        tier: result.tier,
        lane: result.lane,
        stake: result.stake,
        slot: result.slot,
        net: result.net,
        replayed: result.replayed,
      });
      void AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
    },
    onError: (e: Error, input) => {
      track('forge_drop_failed', { stake: input.stake, lane: input.lane, reason: e.message.slice(0, 80) });
      useToastStore.getState().push({ kind: 'error', title: 'DROP NOT PLAYED', subtitle: e.message });
    },
  });
}

/**
 * DID THAT WAGER LAND?
 *
 * The recovery path, and the reason the key is written to disk before the
 * request goes out. When a client cannot tell whether its drop settled — the
 * tunnel died, the tab was closed, the phone slept — it ASKS. Never wagers
 * again.
 *
 * `forge_drop_fetch` returns null when the key was never played, which is the
 * signal that the coins were never taken and the key can be discarded.
 */
export function useRecoverDrop() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useCallback(async (): Promise<DropResult | null> => {
    let key: string | null = null;
    try {
      key = await AsyncStorage.getItem(PENDING_KEY);
    } catch {
      return null;
    }
    if (!key) return null;
    try {
      const { data, error } = await supabase.rpc('forge_drop_fetch', { p_key: key });
      if (error) return null;
      await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
      if (!data) return null;
      const r = data as DropResult & { multiplier: string | number; path: number[] };
      refreshDrop(queryClient, userId);
      track('forge_drop_replayed', { tier: r.tier, stake: r.stake });
      return { ...r, multiplier: Number(r.multiplier), path: (r.path ?? []).map(Number) };
    } catch {
      // Still offline. Leave the key on disk so the next launch can ask again —
      // discarding it is how a settled wager becomes unaccountable.
      return null;
    }
  }, [queryClient, userId]);
}

/** Mint a key and remember it, BEFORE the wager goes out. */
export async function beginDrop(): Promise<string> {
  const key = Crypto.randomUUID();
  await AsyncStorage.setItem(PENDING_KEY, key).catch(() => undefined);
  return key;
}
