import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * FRIENDS + RIVALRY client layer (Tyson, 2026-07-17) — migration 036. Everything
 * goes through the SECURITY DEFINER RPCs; the client never touches the tables.
 * The foundation for ghost battles, damage assessment and live matchmaking
 * (MULTIPLAYER_ROADMAP.md).
 */

export interface Friend {
  id: string;
  display_name: string;
  my_wins: number;
  their_wins: number;
  draws: number;
}

export interface FriendRequest {
  id: string;
  from_id: string;
  display_name: string;
}

export function useFriends() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['friends', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<Friend[]> => {
      const { data, error } = await supabase.rpc('my_friends');
      if (error) throw error;
      return (data ?? []) as Friend[];
    },
  });
}

export function useFriendRequests() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['friend_requests', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<FriendRequest[]> => {
      const { data, error } = await supabase.rpc('my_friend_requests');
      if (error) throw error;
      return (data ?? []) as FriendRequest[];
    },
  });
}

export function useRespondRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }): Promise<void> => {
      const { error } = await supabase.rpc('respond_friend_request', { p_request: id, p_accept: accept });
      if (error) throw new Error('Could not respond. Try again.');
    },
    onSuccess: (_r, { accept }) => {
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['friend_requests'] });
      if (accept) useToastStore.getState().push({ kind: 'achievement', title: 'RIVAL ADDED', subtitle: 'Bring it on.' });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'FAILED', subtitle: e.message }),
  });
}
