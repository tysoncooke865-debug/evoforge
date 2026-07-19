import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';
import { useToastStore } from '@/state/toast-store';

/**
 * MODERATION + ACCOUNT (2026-07-19, migration 069 + delete-account fn) — the
 * App-Store safety surface: block/unblock other athletes, report objectionable
 * content on any UGC surface, and delete your own account. Blocks are the
 * user's own data (my_blocks); the client hides blocked users everywhere it
 * lists people or content.
 */

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** The ids the caller has blocked — used to hide them across feeds/lists. */
export function useMyBlocks() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['my_blocks', userId],
    enabled: userId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      try {
        const { data, error } = await supabase.rpc('my_blocks');
        return error || !Array.isArray(data) ? [] : (data as string[]);
      } catch {
        return [];
      }
    },
  });
}

/** A Set for O(1) `blocked.has(id)` filtering at call sites. */
export function useBlockedSet(): Set<string> {
  const blocks = useMyBlocks();
  return new Set(blocks.data ?? []);
}

export function useBlockUser() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (target: string) => {
      const { error } = await supabase.rpc('block_user', { p_user: target });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // Blocking severs friendship + hides them, so refresh the lists that show people.
      for (const k of ['my_blocks', 'my_friends', 'friends', 'discover_athletes', 'recommended_athletes', 'social_feed', 'athlete_profile']) {
        void queryClient.invalidateQueries({ queryKey: [k, userId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['social_feed'] });
      useToastStore.getState().push({ kind: 'info', title: 'BLOCKED', subtitle: "You won't see each other." });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT BLOCKED', subtitle: e.message });
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (target: string) => {
      const { error } = await supabase.rpc('unblock_user', { p_user: target });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my_blocks', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'UNBLOCKED', subtitle: '' });
    },
  });
}

export type ReportTarget = 'comment' | 'gym_message' | 'profile';

export function useReportContent() {
  return useMutation({
    mutationFn: async (input: { type: ReportTarget; id: string; reason: string; note?: string }) => {
      const { data, error } = await supabase.rpc('report_content', {
        p_type: input.type,
        p_id: input.id,
        p_reason: input.reason,
        p_note: input.note ?? null,
      });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) throw new Error(r.reason === 'rate_limited' ? 'Too many reports — try later.' : 'Could not report.');
    },
    onSuccess: () => {
      useToastStore.getState().push({ kind: 'info', title: 'REPORTED', subtitle: 'Our team will review it.' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT REPORTED', subtitle: e.message });
    },
  });
}

/** Delete the signed-in account (Apple 5.1.1(v)). The caller re-types DELETE;
 *  the edge function resolves WHOSE account from the JWT and cascades. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(r.error ?? 'Could not delete the account.');
    },
  });
}
