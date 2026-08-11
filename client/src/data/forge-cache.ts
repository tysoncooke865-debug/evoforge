import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { friendlyCacheError } from '@/domain/forge-cache-errors';
import { todayIso } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { invalidateTable } from './keys';
import { supabase } from './supabase';

/**
 * THE DAILY FORGE CACHE AND THE RECOVERY RUN — the client half of migration 166,
 * which shipped without one.
 *
 * BOTH FEATURES HAD NEVER PAID A SINGLE COIN. 166 built the seven-tier ladder, the
 * tiers table, the claim guards, the RLS, the idempotency and the Recovery Run — and
 * nothing in the app ever called `forge_cache_claim()` or `recovery_run_claim()`.
 * Zero claims, zero coin events, zero recovery runs, ever. This file is what turns
 * two shipped features on.
 *
 * That matters most for the Recovery Run, which is the app's guarantee that nobody
 * can be locked out of the economy — cited as exactly that in the legal pack. The
 * guarantee existed in SQL and had never once executed.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: reward opening the app. The brief asked for 15
 * coins on first open each day; Tyson declined, because §6 says the cache is "tied to
 * genuine training activity, never app-opening". There is no login grant here and no
 * code path that could become one — the card is informational, and the coins are
 * earned by training or by confirming a planned rest day (189).
 *
 * NO RNG, no chance table, no multiplier, no stake, no balance decrease. Every amount
 * comes from `forge_cache_tiers` server-side; nothing here chooses a number.
 */

const CACHE_KEY = 'forge_cache_state';

/** The pure mapping lives in domain/ — testable without react-query. */
export { friendlyCacheError } from '@/domain/forge-cache-errors';
const RECOVERY_KEY = 'recovery_run_state';

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

export interface ForgeCacheState {
  cycle: number;
  /** 0–7. Plan-adherent days in this cycle: trained, or confirmed rest (189). */
  rung: number;
  coins?: number;
  label?: string;
  claimable: boolean;
  trained_this_cycle: number;
  adherent_this_cycle: number;
  /** Training days a cycle needs before the weekly cache opens. */
  training_floor: number;
  floor_met: boolean;
  training_day?: string | null;
  today_is_rest: boolean;
  today_rest_confirmed: boolean;
  today_plan: string | null;
  next_coins: number;
  next_label: string;
  message: string;
}

export interface RecoveryRunState {
  balance: number;
  eligible: boolean;
  armed: boolean;
  sets_done: number;
  sets_needed: number;
  coins: number;
  message: string;
}

/**
 * Where the ladder stands. Null on any failure, never a fabricated zero — the coins
 * doctrine, so an unreadable state hides the card rather than claiming rung 0.
 */
export function useForgeCacheState() {
  const userId = useUserId();
  return useQuery({
    queryKey: [CACHE_KEY, userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<ForgeCacheState | null> => {
      // 198: the athlete's OWN calendar date, not the server's UTC one.
      // domain/today.ts carries the lesson: east of Greenwich the UTC date is
      // yesterday for the first hours of every day, which is exactly when
      // people train. The server clamps what it is sent to +/-1 day, so this
      // is the athlete's answer without being a trusted one.
      const { data, error } = await supabase.rpc('forge_cache_state', { p_today: todayIso() });
      if (error) return null;
      return (data ?? null) as ForgeCacheState | null;
    },
  });
}

export function useRecoveryRunState() {
  const userId = useUserId();
  return useQuery({
    queryKey: [RECOVERY_KEY, userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<RecoveryRunState | null> => {
      const { data, error } = await supabase.rpc('recovery_run_state');
      if (error) return null;
      return (data ?? null) as RecoveryRunState | null;
    },
  });
}

function refreshCache(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  void queryClient.invalidateQueries({ queryKey: [CACHE_KEY, userId] });
  void queryClient.invalidateQueries({ queryKey: [RECOVERY_KEY, userId] });
  void queryClient.invalidateQueries({ queryKey: ['coin_total', userId] });
  invalidateTable(queryClient, 'coin_events');
}

/**
 * CLAIM THE OPEN RUNG.
 *
 * Idempotent server-side: a second call returns `already` and pays nothing, so a
 * double tap, a retry and two devices all land on the same result.
 */
export function useClaimForgeCache() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('forge_cache_claim', { p_today: todayIso() });
      if (error) throw new Error(friendlyCacheError(error.message));
      return data as {
        already: boolean;
        cycle: number;
        rung: number;
        coins: number;
        label?: string;
        cycle_complete?: boolean;
      };
    },
    onSuccess: (r) => {
      refreshCache(queryClient, userId);
      if (r.already || r.coins <= 0) return; // a repeat is not news
      track('daily_cache_claimed', { rung: r.rung, coins: r.coins, cycle: r.cycle });
      if (r.cycle_complete) track('daily_cache_cycle_completed', { cycle: r.cycle });
      else track('daily_cache_cycle_advanced', { rung: r.rung });
      useToastStore.getState().push({
        kind: 'info',
        title: `FORGE CACHE +${r.coins}`,
        subtitle: r.cycle_complete
          ? 'Weekly cache claimed. A new cycle starts on your next plan-adherent day.'
          : (r.label ?? 'Banked.'),
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'CACHE NOT OPEN', subtitle: e.message });
    },
  });
}

/**
 * CONFIRM TODAY IS A PLANNED REST DAY.
 *
 * Refused server-side on any date the plan does not call rest, so this cannot be
 * tapped daily to climb the ladder. §6: rest is part of the plan, never a failure —
 * so nothing here is framed as a concession.
 */
export function useConfirmRestDay() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('forge_rest_confirm', { p_day: todayIso() });
      if (error) throw new Error(friendlyCacheError(error.message));
      return data as { rest_day: string; already: boolean };
    },
    onSuccess: (r) => {
      refreshCache(queryClient, userId);
      if (r.already) return;
      track('daily_checkin_rest_completed', { day: r.rest_day });
      track('daily_checkin_completed', { kind: 'rest' });
      useToastStore.getState().push({
        kind: 'info',
        title: 'REST DAY CONFIRMED',
        // Never an apology and never a consolation: rest advances the plan.
        subtitle: 'Recovery is part of the plan. Your cache moved forward.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT CONFIRM', subtitle: e.message });
    },
  });
}

/** The Recovery Run's fixed 50 coins, once the three sets are in. */
export function useClaimRecoveryRun() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('recovery_run_claim');
      if (error) throw new Error(error.message);
      return data as { already?: boolean; coins?: number };
    },
    onSuccess: (r) => {
      refreshCache(queryClient, userId);
      if (r.already || !r.coins) return;
      track('recovery_run_completed', { coins: r.coins });
      useToastStore.getState().push({
        kind: 'info',
        title: `RECOVERY RUN +${r.coins}`,
        subtitle: 'Back on your feet. Nobody gets locked out.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT READY YET', subtitle: e.message });
    },
  });
}
