import { useIsFocused } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applyReaction,
  toPosts,
  type PostType,
  type ReactionKind,
  type SocialPost,
  type Visibility,
} from '@/domain/social-feed';
import { useToastStore } from '@/state/toast-store';

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
  // PERF: the Social tab is idle-preloaded, so without this the feed RPC would
  // fire on boot for everyone — even users who never open Social. Load it only
  // once the tab is focused (a brief skeleton on first open, nothing lost).
  const focused = useIsFocused();
  return useInfiniteQuery({
    queryKey: ['social_feed', userId, scope],
    enabled: userId !== null && focused,
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

export interface CreatePostInput {
  postType: PostType;
  visibility: Visibility;
  caption: string | null;
  payload: Record<string, unknown>;
}

/** Publish a post (author_id defaults to auth.uid() under 049's RLS). A caption
 *  is required for a bare status; every other type carries a real payload. */
export function useCreatePost() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: CreatePostInput) => {
      const { error } = await supabase.from('social_posts').insert({
        post_type: input.postType,
        visibility: input.visibility,
        caption: input.caption,
        payload: input.payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['social_feed', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'POSTED', subtitle: 'Shared with your feed' });
    },
    onError: (e: Error) =>
      useToastStore.getState().push({ kind: 'error', title: 'NOT POSTED', subtitle: e.message }),
  });
}

/** Soft-delete your own post (RLS: author only). */
export function useDeletePost() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from('social_posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['social_feed', userId] }),
  });
}

export interface CommentRow {
  id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
  mine: boolean;
}

/** A post's comments (via the 050 definer RPC — visibility-checked). */
export function usePostComments(postId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['post_comments', userId, postId],
    enabled: userId !== null && postId !== null,
    queryFn: async (): Promise<CommentRow[]> => {
      try {
        const { data, error } = await supabase.rpc('post_comments', { p_post: postId });
        if (error) return [];
        const d = data as { ok?: boolean; comments?: CommentRow[] } | null;
        return d?.ok && Array.isArray(d.comments) ? d.comments : [];
      } catch {
        return [];
      }
    },
  });
}

/** Add a comment (RLS: author of the comment). Refreshes the thread + counts. */
export function useAddComment() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { postId: string; body: string }) => {
      const { error } = await supabase.from('social_comments').insert({ post_id: input.postId, body: input.body });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      void queryClient.invalidateQueries({ queryKey: ['post_comments', userId, input.postId] });
      void queryClient.invalidateQueries({ queryKey: ['social_feed', userId] });
    },
    onError: (e: Error) =>
      useToastStore.getState().push({ kind: 'error', title: 'NOT SENT', subtitle: e.message }),
  });
}
