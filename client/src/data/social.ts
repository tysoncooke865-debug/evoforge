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

/**
 * REQUESTS I HAVE SENT (migration 199).
 *
 * THE BUG THIS CLOSES: `AddFriendButton` showed `+ ADD` forever. Its only
 * other state was `…` while its own mutation was in flight, so the instant the
 * request landed the button reverted and there was nothing anywhere in the app
 * to say it had ever been sent. Reopening Social showed `+ ADD` again — and
 * the only sensible response is to tap it again, which the unique
 * (from_id, to_id) index correctly refuses, silently.
 *
 * This is not cosmetic. `calloutsAvailable()` gates the pledge control on
 * having an ACCEPTED friend, so an athlete who believes their request never
 * sent never gets a friend, and never sees the Golden Dot in the workout
 * logger. The two audit findings are one bug.
 */
export interface SentFriendRequest {
  id: string;
  to_id: string;
  display_name: string;
  created_at: string;
}

export function useSentFriendRequests() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['sent_friend_requests', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<SentFriendRequest[]> => {
      const { data, error } = await supabase.rpc('my_sent_friend_requests');
      // Degrades to [] only while the FUNCTION is absent (the client ships
      // before the migration is applied by hand). Everything else throws, so a
      // transient blip cannot make a pending request look un-sent — the exact
      // failure this hook exists to end.
      if (error) {
        if (/does not exist|schema cache|PGRST202/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as SentFriendRequest[];
    },
  });
}

/** Withdraw a request I sent. */
export function useCancelFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc('cancel_friend_request', { p_request: id });
      if (error) throw new Error('Could not withdraw that. Try again.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sent_friend_requests'] });
      void queryClient.invalidateQueries({ queryKey: ['friend_requests'] });
    },
    onError: (e: Error) =>
      useToastStore.getState().push({ kind: 'error', title: 'NOT WITHDRAWN', subtitle: e.message }),
  });
}
