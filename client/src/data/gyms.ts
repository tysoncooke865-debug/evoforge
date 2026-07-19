import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';
import { useToastStore } from '@/state/toast-store';

/**
 * GYMS (Tyson, 2026-07-19, migration 068) — player groups your friends and
 * rivals join by code: a private group chat and gym-vs-gym battles decided by
 * aggregate roster Evo Rating. Every read/write goes through the security-
 * definer RPCs (the base tables are RLS-locked with no client policies), so
 * these hooks are thin wrappers that degrade to empty/throw like the rest of
 * the social layer.
 */

export interface Gym {
  gym_id: string;
  name: string;
  description: string | null;
  join_code: string;
  created_at: string;
  my_role: 'owner' | 'member';
  member_count: number;
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
    join_code: string;
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
  return useQuery({
    queryKey: ['gym_messages', userId, gymId],
    enabled: userId !== null && gymId !== null,
    refetchInterval: 5000,
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
      useToastStore.getState().push({ kind: 'info', title: 'GYM CREATED', subtitle: 'Share the code to recruit.' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT CREATED', subtitle: e.message });
    },
  });
}

export function useJoinGym() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('join_gym', { p_code: code });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string; gym_id?: string };
      if (!r.ok) {
        throw new Error(
          r.reason === 'not_found' ? 'No gym with that code.' : r.reason === 'full' ? 'That gym is full.' : 'Could not join.'
        );
      }
      return r;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my_gyms', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'JOINED', subtitle: 'Welcome to the gym.' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT JOINED', subtitle: e.message });
    },
  });
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

export function useGymBattle() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { gymId: string; opponentCode: string }) => {
      const { data, error } = await supabase.rpc('gym_battle', {
        p_my_gym: input.gymId,
        p_opponent_code: input.opponentCode,
      });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string; result?: string; my_score?: number; their_score?: number; opponent_name?: string };
      if (!r.ok) {
        throw new Error(
          r.reason === 'opponent_not_found'
            ? 'No gym with that code.'
            : r.reason === 'same_gym'
              ? "That's your own gym."
              : 'Could not run the battle.'
        );
      }
      return r;
    },
    onSuccess: (r, input) => {
      void queryClient.invalidateQueries({ queryKey: ['gym_detail', userId, input.gymId] });
      const title = r.result === 'win' ? 'VICTORY' : r.result === 'loss' ? 'DEFEAT' : 'DRAW';
      useToastStore.getState().push({
        kind: 'info',
        title: `${title} vs ${r.opponent_name}`,
        subtitle: `${r.my_score} — ${r.their_score} (roster Evo)`,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NO BATTLE', subtitle: e.message });
    },
  });
}
