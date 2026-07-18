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
import { pushNotify } from './push';
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
      const { data, error } = await supabase.rpc('toggle_reaction', { p_post: input.postId, p_kind: input.kind });
      if (error) throw error;
      // Push only when a reaction was ADDED (not toggled off).
      if ((data as { reaction?: string | null } | null)?.reaction) pushNotify({ type: 'reaction', postId: input.postId });
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

/** Soft-delete your own post (RLS: author only). Accepts either a bare id or a
 *  post carrying its photo paths — when photos are present they're removed from
 *  the private bucket so a deleted post leaves no orphaned storage objects. */
export function useDeletePost() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (arg: string | SocialPost) => {
      const postId = typeof arg === 'string' ? arg : arg.id;
      const paths =
        typeof arg === 'string'
          ? []
          : arg.type === 'photo' || arg.type === 'workout'
            ? arg.photoUrls
            : [];
      const { error } = await supabase.from('social_posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId);
      if (error) throw error;
      // Best-effort storage cleanup — the post is already gone from the feed;
      // a failed object removal must not surface as a failed delete.
      if (paths.length > 0) {
        try {
          await supabase.storage.from('social-media').remove(paths);
        } catch {
          /* orphaned objects are inert (private bucket); ignore. */
        }
      }
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
  /** 058: one-level threading + comment reactions. */
  parent_id: string | null;
  reaction_count: number;
  my_reaction: ReactionKind | null;
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

/** Add a comment or a one-level reply (RLS: author of the comment; the 058
 *  depth guard rejects reply-to-reply server-side). Refreshes thread+counts. */
export function useAddComment() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { postId: string; body: string; parentId?: string | null }) => {
      const { error } = await supabase
        .from('social_comments')
        .insert({ post_id: input.postId, body: input.body, parent_id: input.parentId ?? null });
      if (error) throw error;
      pushNotify({ type: 'comment', postId: input.postId });
    },
    onSuccess: (_d, input) => {
      void queryClient.invalidateQueries({ queryKey: ['post_comments', userId, input.postId] });
      void queryClient.invalidateQueries({ queryKey: ['social_feed', userId] });
    },
    onError: (e: Error) =>
      useToastStore.getState().push({ kind: 'error', title: 'NOT SENT', subtitle: e.message }),
  });
}

/** React to a COMMENT (058's toggle_comment_reaction — post-visibility
 *  re-checked server-side). Optimistic on the thread cache; the server
 *  answer settles it via invalidation. */
export function useToggleCommentReaction() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { postId: string; commentId: string; kind: ReactionKind }) => {
      const { data, error } = await supabase.rpc('toggle_comment_reaction', {
        p_comment: input.commentId,
        p_kind: input.kind,
      });
      if (error) throw error;
      if (!(data as { ok?: boolean })?.ok) throw new Error('That comment is not visible any more.');
    },
    onMutate: async (input) => {
      const key = ['post_comments', userId, input.postId];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<CommentRow[]>(key);
      queryClient.setQueryData<CommentRow[]>(key, (rows) =>
        (rows ?? []).map((c) => {
          if (c.id !== input.commentId) return c;
          if (c.my_reaction === input.kind)
            return { ...c, my_reaction: null, reaction_count: Math.max(0, c.reaction_count - 1) };
          return {
            ...c,
            my_reaction: input.kind,
            reaction_count: c.my_reaction ? c.reaction_count : c.reaction_count + 1,
          };
        })
      );
      return { prev, key };
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      useToastStore.getState().push({ kind: 'error', title: 'NO REACTION', subtitle: e.message });
    },
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({ queryKey: ['post_comments', userId, input.postId] });
    },
  });
}

/** Report a post (059 — record-only; INSERT is the only client verb, reads
 *  are service-role). A duplicate unique-violation reads as already done. */
export function useReportPost() {
  return useMutation({
    mutationFn: async (input: { postId: string; reason: 'spam' | 'abuse' | 'nsfw' | 'other'; note?: string }) => {
      const { error } = await supabase.from('social_reports').insert({
        post_id: input.postId,
        reason: input.reason,
        note: input.note?.trim() ? input.note.trim().slice(0, 300) : null,
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) throw new Error('You already reported this post.');
        throw error;
      }
    },
    onSuccess: () =>
      useToastStore.getState().push({
        kind: 'info',
        title: 'REPORTED',
        subtitle: 'Thanks — the team reviews reports.',
      }),
    onError: (e: Error) =>
      useToastStore.getState().push({ kind: 'error', title: 'NOT REPORTED', subtitle: e.message }),
  });
}
