/**
 * REFORGE DAY, wired to real rows (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * The 28-day clock is anchored to the athlete's FIRST logged training day,
 * not to signup: a cycle that started while somebody was still deciding
 * whether to use the app reviews an empty month and teaches them the
 * ceremony is meaningless. Account creation is the fallback for an athlete
 * who somehow reforges before training.
 *
 * The anchor is written once, lazily, the first time this hook sees a
 * training day and no anchor. Migration 134's trigger makes that write-once
 * on the server too, so a client bug cannot rewind anyone's cycle.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/data/auth-context';
import { useProfile, useWorkoutIndex } from '@/data/hooks';
import { supabase } from '@/data/supabase';
import { reforgeCadence, type ReforgeCadence } from '@/domain/progression/reforge-day';
import { todayIso } from '@/domain/today';

export function useReforgeDay(): { cadence: ReforgeCadence; ready: boolean; anchorIso: string | null } {
  const profile = useProfile();
  const index = useWorkoutIndex();
  const setAnchor = useSetReforgeAnchor();

  const dates = index.data?.byDate;
  const firstTrainingDay =
    dates && dates.size > 0 ? [...dates.keys()].sort()[0] : null;

  const storedAnchor = profile.data?.reforge_anchor_at ?? null;
  const anchorIso = (storedAnchor ?? firstTrainingDay ?? null)?.slice(0, 10) ?? null;

  // Persist the anchor once there is something real to anchor to.
  const wroteRef = useRef(false);
  useEffect(() => {
    if (wroteRef.current) return;
    if (profile.isPending || index.isPending) return;
    if (storedAnchor != null || firstTrainingDay == null || profile.data == null) return;
    wroteRef.current = true;
    setAnchor.mutate(firstTrainingDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.isPending, index.isPending, storedAnchor, firstTrainingDay, profile.data]);

  return {
    cadence: reforgeCadence({
      anchorIso,
      lastReforgeIso: profile.data?.last_reforge_at ?? null,
      todayIso: todayIso(),
    }),
    ready: !profile.isPending && !index.isPending,
    anchorIso,
  };
}

function useSetReforgeAnchor() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (iso: string) => {
      const { error } = await supabase
        .from('profile')
        .update({ reforge_anchor_at: `${iso}T00:00:00Z` })
        .eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    // Silent: an unset anchor is re-derived from the log on every read, so a
    // failure here costs nothing an athlete can see.
    onError: () => undefined,
  });
}

/** Stamp a completed Reforge Day. Forward-only, enforced by 134's trigger. */
export function useCompleteReforge() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profile')
        .update({ last_reforge_at: new Date().toISOString() })
        .eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
}
