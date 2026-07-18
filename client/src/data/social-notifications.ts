import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * SOCIAL NOTIFICATIONS (migration 052) — the in-app bell. Reads degrade to
 * empty / zero while the RPCs are absent (the sessions.ts pattern). Marking
 * read clears the badge and refreshes both the count and the list.
 */
export type NotificationType = 'reaction' | 'comment' | 'friend_request' | 'friend_accepted';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  post_id: string | null;
  created_at: string;
  read_at: string | null;
  actor_name: string;
  post_peek: string;
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

export function useUnreadCount() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['notif_unread', userId],
    enabled: userId !== null,
    refetchInterval: 60_000, // a quiet poll; native push replaces this later
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
