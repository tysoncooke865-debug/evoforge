import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toPosts, type SocialPost } from '@/domain/social-feed';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * SOCIAL PROFILE + DISCOVERY + PRIVACY (migration 055). Public athlete profiles,
 * the Discover athletes list, and the owner's field-privacy flags — all through
 * the definer RPCs, which enforce visibility and gate every sensitive field.
 * Reads DEGRADE TO an unusable/empty shape while the RPCs are absent (the
 * sessions.ts pattern): a missing profile reads as "not viewable", never a crash.
 */

export interface EvoPillar { label: string; value: number }
export interface AthleteProfile {
  ok: boolean;
  can_view: boolean;
  is_self: boolean;
  are_friends: boolean;
  is_public?: boolean;
  display_name: string;
  member_since?: string | null;
  forge_level?: number | null;
  rival?: { my_wins: number; their_wins: number; draws: number };
  post_count?: number;
  evo?: { rank: number | null; class: string | null; path: string | null; pillars: EvoPillar[] } | null;
  lifts?: { bench: number | null; squat: number | null; deadlift: number | null; unit: string } | null;
  bodyweight?: number | null;
  privacy?: PrivacyFlags | null;
}

export interface PrivacyFlags {
  is_public: boolean;
  discoverable: boolean;
  show_evo: boolean;
  show_lifts: boolean;
  show_bodyweight: boolean;
}

export interface DiscoverAthlete {
  user_id: string;
  display_name: string;
  forge_level: number | null;
  rank: number | null;
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** One athlete's public profile as the viewer may see it. */
export function useAthleteProfile(athleteId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['athlete_profile', userId, athleteId],
    enabled: userId !== null && athleteId !== null,
    queryFn: async (): Promise<AthleteProfile | null> => {
      try {
        const { data, error } = await supabase.rpc('public_athlete_profile', { p_user: athleteId });
        if (error || !data || typeof data !== 'object') return null;
        return data as AthleteProfile;
      } catch {
        return null;
      }
    },
  });
}

const PAGE = 20;

/** That athlete's posts the viewer may see (own + friends-visible + public). */
export function useAthletePosts(athleteId: string | null, canView: boolean) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: ['athlete_posts', userId, athleteId],
    enabled: userId !== null && athleteId !== null && canView,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<SocialPost[]> => {
      try {
        const { data, error } = await supabase.rpc('athlete_posts', { p_user: athleteId, p_before: pageParam, p_limit: PAGE });
        if (error) return [];
        return toPosts(Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].createdAt),
  });
}

/** Public + discoverable athletes to add (excludes self + current friends). */
export function useDiscoverAthletes() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['discover_athletes', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<DiscoverAthlete[]> => {
      try {
        const { data, error } = await supabase.rpc('discover_athletes', { p_limit: 40 });
        return error || !Array.isArray(data) ? [] : (data as DiscoverAthlete[]);
      } catch {
        return [];
      }
    },
  });
}

/** Username search (060): same exposure rule and row shape as discover —
 *  is_public AND discoverable only, so search never surfaces an athlete the
 *  ADD button then refuses. [] on any failure or a sub-2-char query. */
export function useSearchAthletes(query: string) {
  const userId = useUserId();
  const q = query.trim();
  return useQuery({
    queryKey: ['search_athletes', userId, q.toLowerCase()],
    enabled: userId !== null && q.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<(DiscoverAthlete & { is_friend?: boolean })[]> => {
      try {
        const { data, error } = await supabase.rpc('search_athletes', { p_query: q, p_limit: 20 });
        return error || !Array.isArray(data) ? [] : (data as (DiscoverAthlete & { is_friend?: boolean })[]);
      } catch {
        return [];
      }
    },
  });
}

const REQUEST_REASON: Record<string, string> = {
  self: "That's you.",
  already_friends: "You're already friends.",
  not_addressable: 'This athlete is private — add them by code.',
};

/** Send a friend request by user id (discovery/profile path — migration 055). */
export function useRequestFriend() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (athleteId: string): Promise<{ ok: boolean; accepted?: boolean; reason?: string }> => {
      const { data, error } = await supabase.rpc('request_friend', { p_user: athleteId });
      if (error) throw new Error('Could not send the request. Try again.');
      return data as { ok: boolean; accepted?: boolean; reason?: string };
    },
    onSuccess: (r) => {
      const push = useToastStore.getState().push;
      if (!r.ok) {
        push({ kind: 'error', title: 'NOT SENT', subtitle: REQUEST_REASON[r.reason ?? ''] ?? 'Try again.' });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['friends', userId] });
      void queryClient.invalidateQueries({ queryKey: ['friend_requests', userId] });
      void queryClient.invalidateQueries({ queryKey: ['discover_athletes', userId] });
      void queryClient.invalidateQueries({ queryKey: ['athlete_profile', userId] });
      push(
        r.accepted
          ? { kind: 'achievement', title: 'FRIEND ADDED', subtitle: 'They already invited you — you’re now rivals.' }
          : { kind: 'info', title: 'REQUEST SENT', subtitle: 'They’ll see it next time they open EvoForge.' }
      );
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT SENT', subtitle: e.message }),
  });
}

/** Update the caller's own privacy flags. Any omitted field is left unchanged. */
export function useSetPrivacy() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (patch: Partial<PrivacyFlags>): Promise<PrivacyFlags> => {
      const { data, error } = await supabase.rpc('set_privacy', {
        p_is_public: patch.is_public ?? null,
        p_discoverable: patch.discoverable ?? null,
        p_show_evo: patch.show_evo ?? null,
        p_show_lifts: patch.show_lifts ?? null,
        p_show_bodyweight: patch.show_bodyweight ?? null,
      });
      if (error) throw new Error('Could not save. Try again.');
      return data as PrivacyFlags;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['athlete_profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['discover_athletes', userId] });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message }),
  });
}
