import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StreakPause } from '@/domain/scheduled-streak';
import { DEFAULT_GRACE_PER_30D } from '@/domain/scheduled-streak';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * STREAK PROTECTION — grace days and the pause (migration 179, Spec v5 §6).
 *
 * Two mechanisms with deliberately different shapes. GRACE is automatic, silent
 * and rationed: two missed planned days per rolling 30, absorbed without anyone
 * being asked. A PAUSE is declared, open-ended and unrationed, because rationing
 * "I broke my wrist" is the pressure §6 exists to remove.
 *
 * NEITHER IS PURCHASABLE, and there is no code here that could make them so. A
 * "buy a streak freeze" surface is the pattern §8 calls a compliance defect, not
 * a monetisation idea, and the absence is the point.
 */

const KEY = 'streak_state';

export interface StreakState {
  grace_per_30d: number;
  grace_used_30d: number;
  paused: boolean;
  paused_since: string | null;
  pause_reason: string | null;
}

const FALLBACK: StreakState = {
  grace_per_30d: DEFAULT_GRACE_PER_30D,
  grace_used_30d: 0,
  paused: false,
  paused_since: null,
  pause_reason: null,
};

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/**
 * The allowance and whether a pause is running.
 *
 * FALLS BACK RATHER THAN FAILING. If 179 is not applied on this environment the
 * screen shows the default allowance and no pause, which is exactly the behaviour
 * before the migration — a streak screen must never be an error surface.
 */
export function useStreakState() {
  const userId = useUserId();
  return useQuery({
    queryKey: [KEY, userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<StreakState> => {
      const { data, error } = await supabase.rpc('my_streak_state');
      if (error) return FALLBACK;
      return { ...FALLBACK, ...(data as Partial<StreakState>) };
    },
  });
}

/** Every pause this athlete has ever declared — the streak maths needs them all. */
export function useStreakPauses() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['streak_pauses', userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<StreakPause[]> => {
      const { data, error } = await supabase
        .from('streak_pauses')
        .select('started_on, ended_on')
        .order('started_on', { ascending: false })
        .limit(200);
      // An unreadable pause list must not silently BREAK a streak that a pause
      // was holding together, but it cannot invent one either. Empty is the only
      // honest answer, and the server's own count is unaffected.
      if (error) return [];
      return (data ?? []) as StreakPause[];
    },
  });
}

export function useToggleStreakPause() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({ pause, reason }: { pause: boolean; reason?: string }) => {
      const { error } = pause
        ? await supabase.rpc('streak_pause_start', { p_reason: reason ?? null })
        : await supabase.rpc('streak_pause_end');
      if (error) throw new Error(error.message);
      return pause;
    },
    onSuccess: (paused) => {
      void queryClient.invalidateQueries({ queryKey: [KEY, userId] });
      void queryClient.invalidateQueries({ queryKey: ['streak_pauses', userId] });
      useToastStore.getState().push({
        kind: 'info',
        title: paused ? 'STREAK PAUSED' : 'STREAK RESUMED',
        // No urgency either way. Pausing is not a loss and resuming is not a debt.
        subtitle: paused
          ? 'Take the time you need. Nothing is lost while you are away.'
          : 'Welcome back.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT CHANGE THAT', subtitle: e.message });
    },
  });
}
