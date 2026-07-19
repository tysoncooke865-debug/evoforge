import { useIsFocused } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { pushNotify } from './push';
import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * SOCIAL NOTIFICATIONS (migration 052, +058 comment_*, +072 pr_beaten) — the
 * in-app bell. Reads degrade to empty / zero while the RPCs are absent (the
 * sessions.ts pattern). Marking read clears the badge and refreshes both the
 * count and the list.
 */
export type NotificationType =
  | 'reaction'
  | 'comment'
  | 'friend_request'
  | 'friend_accepted'
  | 'mention'
  | 'comment_reaction'
  | 'comment_reply'
  | 'pr_beaten';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  post_id: string | null;
  created_at: string;
  read_at: string | null;
  actor_name: string;
  post_peek: string;
  /** Type-specific payload (072): pr_beaten carries { exercise, e1rm }. */
  detail?: { exercise?: string; e1rm?: number } | null;
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

export function useUnreadCount() {
  const userId = useUserId();
  // PERF: only poll while the Social tab is FOCUSED — the idle preload keeps
  // this screen mounted, so an ungated interval would fire every 60s on every
  // other tab too. The badge only shows on the Social header anyway; switching
  // back refetches on focus. (Native push replaces the poll later.)
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['notif_unread', userId],
    enabled: userId !== null,
    refetchInterval: focused ? 60_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<number> => {
      try {
        const { data, error } = await supabase.rpc('unread_notification_count');
        return error ? 0 : Number(data) || 0;
      } catch {
        return 0;
      }
    },
  });
}

export function useNotifications() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<NotificationRow[]> => {
      try {
        const { data, error } = await supabase.rpc('my_notifications', { p_limit: 40 });
        return error || !Array.isArray(data) ? [] : (data as NotificationRow[]);
      } catch {
        return [];
      }
    },
  });
}

/**
 * RIVALRY PR ALERT (072): after a confirmed PR, tell any FRIEND whose best for
 * this lift you just surpassed. report_pr_crossings inserts the in-app rows and
 * returns the crossed friends' ids; we fire the push twin to each. Fire-and-
 * forget — a friend alert must never affect the set save. Web-only push, but the
 * in-app notification lands regardless of platform.
 */
export async function reportPrCrossings(exercise: string, newE1rm: number, prevE1rm: number): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('report_pr_crossings', {
      p_exercise: exercise,
      p_new_e1rm: newE1rm,
      p_prev_e1rm: prevE1rm,
    });
    if (error || !Array.isArray(data)) return;
    for (const friendId of data as string[]) {
      pushNotify({ type: 'pr_beaten', toUser: friendId, exercise });
    }
  } catch {
    /* best effort */
  }
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_notifications_read');
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notif_unread', userId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });
}
