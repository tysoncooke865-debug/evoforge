import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { useProfile } from './hooks';
import { supabase } from './supabase';

/**
 * WORKOUT CALL OUTS — on or off (§30).
 *
 * SERVER-SIDE, not a device setting, and that is the whole design decision.
 * `perfMode` and `soundEnabled` live in a Zustand store because they only
 * affect the screen in front of you. This one also decides whether a FRIEND can
 * put fifty coins on your bench press — so it has to be a fact the server knows
 * (150's `profile.callouts_enabled`, checked inside `callout_create`), not a
 * flag on one of your devices.
 *
 * Off means genuinely off: no affordance in Train, no live cards, and nobody can
 * target you. Everything else about training and friends is untouched — this is
 * a serious workout logger first, and somebody who only wants that should never
 * feel pushed into the competitive layer.
 */

export function useCalloutsEnabled(): { enabled: boolean; ready: boolean } {
  const profile = useProfile();
  return {
    // Default ON while the row loads AND when the column is absent (a database
    // that has not taken 150 yet). The reveal rule in domain/callouts.ts is what
    // keeps the affordance from appearing before it means anything, so an
    // optimistic default here cannot show a wager button to a brand-new athlete.
    enabled: profile.data?.callouts_enabled !== false,
    ready: !profile.isPending,
  };
}

export function useSetCalloutsEnabled() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error, count } = await supabase
        .from('profile')
        .update({ callouts_enabled: enabled }, { count: 'exact' })
        .eq('user_id', userId!);
      if (error) throw error;
      // The photo-prefs lesson: an update that matched no row is a silent
      // no-op, and a toggle that flips back on the next refetch reads as the
      // app ignoring you.
      if ((count ?? 0) === 0) throw new Error('No profile row to update.');
    },
    onSuccess: (_r, enabled) => {
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['workout_callouts', userId] });
      track('callout_setting_changed', { enabled });
      if (!enabled) {
        useToastStore.getState().push({
          kind: 'info',
          title: 'CALL OUTS OFF',
          subtitle: 'Nobody can call you out, and Train goes back to just training.',
        });
      }
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
  });
}
