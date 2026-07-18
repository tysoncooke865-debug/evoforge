import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  applyReaction,
  toPosts,
  type ReactionKind,
  type SocialPost,
} from '@/domain/social-feed';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * SOCIAL FEED — the data seams over migration 049's RPCs. Reads DEGRADE TO
 * EMPTY while the feed backend is absent (the sessions.ts pattern): the RPC
 * may not exist until 049 is applied, and a missing feed must read as "nothing
 * yet", never a crash. Reactions optimistically toggle through the pure domain
 * and roll back on error.
 */

export type FeedScope = 'following' | 'rivals' | 'discover';

const PAGE = 20;

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** One page of the feed for a scope, keyset by the oldest createdAt seen. */
export function useSocialFeed(scope: FeedScope) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: ['social_feed', userId, scope],
    enabled: userId !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<SocialPost[]> => {
      try {
        const { data, error } = await supabase.rpc('social_feed', {
          p_scope: scope,
          p_before: pageParam,
          p_limit: PAGE,
        });
        if (error) return [];
        return toPosts(Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].createdAt),
  });
}

/** Optimistically toggle a reaction across every cached feed page. */
export function useToggleReaction() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  const patch = (postId: string, kind: ReactionKind) => {
    queryClient.setQueriesData<{ pages: SocialPost[][] }>({ queryKey: ['social_feed', userId] }, (old) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page) =>
          page.map((p) => (p.id === postId ? ({ ...p, ...applyReaction(p, kind) } as SocialPost) : p))
        ),
      };
    });
  };

  return useMutation({
    mutationFn: async (input: { postId: string; kind: ReactionKind }) => {
      const { error } = await supabase.rpc('toggle_reaction', { p_post: input.postId, p_kind: input.kind });
      if (error) throw error;
    },
    onMutate: (input) => {
      patch(input.postId, input.kind);
    },
    onError: () => {
      // Roll back by refetching the affected scope's pages.
      void queryClient.invalidateQueries({ queryKey: ['social_feed', userId] });
    },
  });
}
