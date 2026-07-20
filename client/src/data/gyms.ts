import { Platform, Share } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { useAuth } from './auth-context';
import { supabase } from './supabase';
import { useToastStore } from '@/state/toast-store';
import { runGymBattle, type GymBattleResult, type GymCombatMember } from '@/domain/battle-rpg/gym-battle';

/**
 * GYMS (Tyson, 2026-07-19, migration 068; codes retired → discovery 076) —
 * player groups: a private group chat and gym-vs-gym battles decided by aggregate
 * roster Evo Rating. Found by BROWSE/SEARCH (discover_gyms) and joined by id, or
 * via a shareable gym LINK for private crews. Every read/write goes through the
 * security-definer RPCs (the base tables are RLS-locked with no client policies).
 */

export interface Gym {
  gym_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  my_role: 'owner' | 'member';
  member_count: number;
}

/** A public gym in the discovery list (discover_gyms, 076). */
export interface DiscoverGym {
  gym_id: string;
  name: string;
  description: string | null;
  owner_name: string;
  member_count: number;
  is_full: boolean;
  is_member: boolean;
  roster_power: number;
}

export interface GymMember {
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  forge_level: number | null;
  evo_rating: number | null;
}

export interface GymMessage {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface GymBattle {
  id: string;
  a_gym: string;
  b_gym: string;
  a_score: number;
  b_score: number;
  winner_gym: string | null;
  created_at: string;
  a_name: string;
  b_name: string;
}

export interface GymDetail {
  ok: boolean;
  can_view: boolean;
  gym?: {
    id: string;
    name: string;
    description: string | null;
    is_public: boolean;
    my_role: 'owner' | 'member';
    roster_power: number;
  };
  members?: GymMember[];
  battles?: GymBattle[];
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

export function useMyGyms() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['my_gyms', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<Gym[]> => {
      try {
        const { data, error } = await supabase.rpc('my_gyms');
        return error || !Array.isArray(data) ? [] : (data as Gym[]);
      } catch {
        return [];
      }
    },
  });
}

export function useGymDetail(gymId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['gym_detail', userId, gymId],
    enabled: userId !== null && gymId !== null,
    queryFn: async (): Promise<GymDetail | null> => {
      try {
        const { data, error } = await supabase.rpc('gym_detail', { p_gym: gymId });
        if (error) return null;
        return data as GymDetail;
      } catch {
        return null;
      }
    },
  });
}

/** Group chat — polls every 5s while the screen is focused (the notifications
 *  precedent; there is no realtime channel for chat). */
export function useGymMessages(gymId: string | null) {
  const userId = useUserId();
  // Only poll while the gym screen is FOCUSED — the notifications precedent, so
  // a backgrounded gym tab doesn't churn a 5s RPC (battery/network on the PWA).
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['gym_messages', userId, gymId],
    enabled: userId !== null && gymId !== null,
    refetchInterval: focused ? 5000 : false,
    queryFn: async (): Promise<GymMessage[]> => {
      try {
        const { data, error } = await supabase.rpc('gym_messages', { p_gym: gymId, p_limit: 50 });
        return error || !Array.isArray(data) ? [] : (data as GymMessage[]);
      } catch {
        return [];
      }
    },
  });
}

export function useCreateGym() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const { data, error } = await supabase.rpc('create_gym', {
        p_name: input.name,
        p_description: input.description ?? null,
      });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string; gym_id?: string };
      if (!r.ok) {
        throw new Error(
          r.reason === 'bad_name'
            ? 'Name must be 3–30 characters.'
            : r.reason === 'too_many'
              ? 'You already own the maximum of 3 gyms.'
              : 'Could not create the gym.'
        );
      }
      return r;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my_gyms', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'GYM CREATED', subtitle: 'It’s public — athletes can find and join it.' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT CREATED', subtitle: e.message });
    },
  });
}

/** Browse/search PUBLIC gyms to join (discovery — replaces join-by-code). */
export function useDiscoverGyms(query: string) {
  const userId = useUserId();
  const q = query.trim();
  return useQuery({
    queryKey: ['discover_gyms', userId, q.toLowerCase()],
    enabled: userId !== null,
    staleTime: 20_000,
    queryFn: async (): Promise<DiscoverGym[]> => {
      try {
        const { data, error } = await supabase.rpc('discover_gyms', { p_query: q, p_limit: 30 });
        return error || !Array.isArray(data) ? [] : (data as DiscoverGym[]);
      } catch {
        return [];
      }
    },
  });
}

/** Join a gym by id (public), or via its share token (a shared private link). */
export function useJoinGym() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (arg: { gymId: string; token?: string | null }) => {
      const { data, error } = await supabase.rpc('join_gym_by_id', { p_gym: arg.gymId, p_token: arg.token ?? null });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string; gym_id?: string };
      if (!r.ok) {
        throw new Error(
          r.reason === 'not_found'
            ? 'That gym no longer exists.'
            : r.reason === 'full'
              ? 'That gym is full.'
              : r.reason === 'not_addressable'
                ? 'That gym is private — open its shared link to join.'
                : 'Could not join.'
        );
      }
      return r;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my_gyms', userId] });
      void queryClient.invalidateQueries({ queryKey: ['discover_gyms', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'JOINED', subtitle: 'Welcome to the gym.' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT JOINED', subtitle: e.message });
    },
  });
}

/** Owner toggles whether the gym is browsable (public) or link-only (private). */
export function useSetGymPublic() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (arg: { gymId: string; isPublic: boolean }) => {
      const { error } = await supabase.rpc('set_gym_public', { p_gym: arg.gymId, p_public: arg.isPublic });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, arg) => {
      void queryClient.invalidateQueries({ queryKey: ['gym_detail', userId, arg.gymId] });
      void queryClient.invalidateQueries({ queryKey: ['my_gyms', userId] });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message }),
  });
}

/** Share (native sheet) or copy (web) a gym's invite link — works even if the
 *  gym is private (the token authorises the join, 076). Best-effort. */
export async function shareGymInvite(gymId: string): Promise<void> {
  let token: string | null = null;
  try {
    const { data } = await supabase.rpc('my_gym_share_token', { p_gym: gymId });
    token = typeof data === 'string' ? data : null;
  } catch {
    /* no token */
  }
  const base =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://expo-rewrite.evoforge.pages.dev';
  const url = token ? `${base}/gym/${gymId}?invite=${token}` : `${base}/gym/${gymId}`;
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav && 'share' in nav && typeof nav.share === 'function') {
        await nav.share({ title: 'EvoForge', text: 'Join my gym on EvoForge', url });
      } else if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
        useToastStore.getState().push({ kind: 'info', title: 'LINK COPIED', subtitle: 'Share it to recruit.' });
      }
    } else {
      await Share.share({ message: `Join my gym on EvoForge — ${url}` });
    }
  } catch {
    /* cancelled */
  }
}

export function useLeaveGym() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (gymId: string) => {
      const { error } = await supabase.rpc('leave_gym', { p_gym: gymId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my_gyms', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'LEFT THE GYM', subtitle: '' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT LEAVE', subtitle: e.message });
    },
  });
}

export function usePostGymMessage() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { gymId: string; body: string }) => {
      const { error } = await supabase.rpc('post_gym_message', { p_gym: input.gymId, p_body: input.body });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, input) => {
      void queryClient.invalidateQueries({ queryKey: ['gym_messages', userId, input.gymId] });
    },
  });
}

export interface GymBattleOutcome extends GymBattleResult {
  result: 'win' | 'loss' | 'draw';
  opponent_name: string;
  my_name: string;
}

interface PrepareResult {
  ok: boolean;
  reason?: string;
  opponent_gym?: string;
  opponent_name?: string;
  my_name?: string;
  seed?: number;
  my_roster?: GymCombatMember[];
  opp_roster?: GymCombatMember[];
}

/**
 * FULL GYM BATTLE (migration 070): the server hands over both rosters' combat
 * inputs + a seed (gym_battle_prepare); the RPG engine runs each member-vs-
 * member duel deterministically on the client; record_gym_battle stores the
 * tally + per-duel log. Cosmetic (no farmable rewards), so the client-run
 * engine is safe.
 */
export function useGymBattle() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { gymId: string; opponentGym: string }): Promise<GymBattleOutcome> => {
      const prep = await supabase.rpc('gym_battle_prepare', {
        p_my_gym: input.gymId,
        p_opponent: input.opponentGym,
      });
      if (prep.error) throw new Error(prep.error.message);
      const p = prep.data as PrepareResult;
      if (!p.ok) {
        throw new Error(
          p.reason === 'opponent_not_found'
            ? 'That gym no longer exists.'
            : p.reason === 'same_gym'
              ? "That's your own gym."
              : p.reason === 'rate_limited'
                ? 'Too many battles — wait a moment.'
                : 'Could not start the battle.'
        );
      }
      // Run the real engine, member-vs-member, from the server seed.
      const outcome = runGymBattle(p.my_roster ?? [], p.opp_roster ?? [], p.seed ?? 1);
      const result: 'win' | 'loss' | 'draw' =
        outcome.a_score > outcome.b_score ? 'win' : outcome.b_score > outcome.a_score ? 'loss' : 'draw';
      // Record it (winner derived server-side from the scores).
      const rec = await supabase.rpc('record_gym_battle', {
        p_my_gym: input.gymId,
        p_opponent: p.opponent_gym,
        p_a_score: outcome.a_score,
        p_b_score: outcome.b_score,
        p_detail: { seed: p.seed, duels: outcome.duels },
      });
      if (rec.error) throw new Error(rec.error.message);
      return {
        ...outcome,
        result,
        opponent_name: p.opponent_name ?? 'Rival Gym',
        my_name: p.my_name ?? 'Your Gym',
      };
    },
    onSuccess: (r, input) => {
      void queryClient.invalidateQueries({ queryKey: ['gym_detail', userId, input.gymId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NO BATTLE', subtitle: e.message });
    },
  });
}
