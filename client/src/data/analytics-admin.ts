import { useQuery } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ADMIN ANALYTICS (migration 080) — the read side of the product-metrics
 * rollups. Every RPC is `security definer` and raises unless is_app_admin(), so
 * these are safe to call from any authenticated client: a non-admin simply gets
 * an empty/null result, never another user's data. The Insights screen is the
 * only consumer.
 */

export interface AnalyticsOverview {
  generated_at: string;
  total_users: number;
  signups_today: number;
  signups_7d: number;
  signups_30d: number;
  dau: number;
  wau: number;
  mau: number;
  active_now: number;
  sets_logged_7d: number;
  workouts_logged_7d: number;
  avg_session_min: number | null;
  avg_time_on_app_min: number | null;
  never_returned: number;
}

export interface AnalyticsDay {
  day: string;
  signups: number;
  active_users: number;
  sets_logged: number;
  workouts_logged: number;
}

export interface TopPage {
  page: string;
  views: number;
  unique_users: number;
  avg_seconds: number | null;
}

/** True when the signed-in user is in app_admins. Fails CLOSED — any error or
 *  non-admin resolves to false, so the Insights screen never leaks. */
export function useIsAdmin() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['is_admin', userId],
    enabled: userId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      try {
        const { data, error } = await supabase.rpc('is_app_admin');
        return !error && data === true;
      } catch {
        return false;
      }
    },
  });
}

export function useAnalyticsOverview(enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['analytics_overview', userId],
    enabled: enabled && userId !== null,
    queryFn: async (): Promise<AnalyticsOverview | null> => {
      const { data, error } = await supabase.rpc('analytics_overview');
      if (error || !data) return null;
      return data as AnalyticsOverview;
    },
  });
}

export function useAnalyticsDaily(days: number, enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['analytics_daily', userId, days],
    enabled: enabled && userId !== null,
    queryFn: async (): Promise<AnalyticsDay[]> => {
      const { data, error } = await supabase.rpc('analytics_daily', { p_days: days });
      if (error || !Array.isArray(data)) return [];
      return data as AnalyticsDay[];
    },
  });
}

export function useAnalyticsTopPages(days: number, enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['analytics_top_pages', userId, days],
    enabled: enabled && userId !== null,
    queryFn: async (): Promise<TopPage[]> => {
      const { data, error } = await supabase.rpc('analytics_top_pages', { p_days: days });
      if (error || !Array.isArray(data)) return [];
      return data as TopPage[];
    },
  });
}
