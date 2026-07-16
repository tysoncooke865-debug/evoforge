import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SourceIndex } from '@/domain/plan-sources';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * THE SAVED PLAN-SOURCE CHOICE (migration 035) — which of MY PLAN / AI PLAN /
 * BUILT-IN the athlete follows, persisted on their profile row so the choice
 * survives reloads and follows the account across devices.
 *
 * The read degrades to null while the column does not exist (deployed-before-
 * migrated), exactly like user_plans/routines — null means "never chosen" and
 * the caller falls back to defaultSource(), which is the pre-035 behaviour.
 *
 * Sign-out safety: pure react-query, per-user key — auth-context's
 * queryClient.clear() covers it. No store, no extra wiring.
 */

export function usePlanSourcePref() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['plan_source_pref', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<SourceIndex | null> => {
      try {
        // Latest row wins — same multi-row semantics as useProfile.
        const { data, error } = await supabase
          .from('profile')
          .select('active_plan_source,created_at')
          .order('created_at', { ascending: true })
          .limit(2500);
        if (error) return null;
        const rows = (data ?? []) as { active_plan_source: unknown }[];
        if (rows.length === 0) return null;
        const v = rows[rows.length - 1].active_plan_source;
        return v === 0 || v === 1 || v === 2 ? v : null;
      } catch {
        return null;
      }
    },
  });
}

export function useSavePlanSourcePref() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (source: SourceIndex) => {
      const { error, count } = await supabase
        .from('profile')
        .update({ active_plan_source: source }, { count: 'exact' })
        .eq('user_id', userId!);
      if (error) throw error;
      if ((count ?? 0) === 0) throw new Error('No profile row to update.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan_source_pref', userId] });
    },
    onError: (e: Error) => {
      // The local choice still applies for this session; the toast is the
      // honest warning that a reload will forget it.
      useToastStore.getState().push({ kind: 'error', title: 'CHOICE NOT SYNCED', subtitle: e.message });
    },
  });
}
