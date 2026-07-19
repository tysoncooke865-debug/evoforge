/**
 * PROGRESSION_OVERHAUL P3 — the Evo Rating hooks. Reads follow the house
 * pattern (per-user query keys, cached-first); the due-review runner is a
 * mutation the shell fires when the flag is on and a review is due.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/data/auth-context';
import { supabase } from '@/data/supabase';

import { runDueEvoReview } from './evo-review-io';

export function useEvoRatingCurrent() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['evo_rating_current', userId],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.from('evo_rating_current').select('*').limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useEvoSnapshots(limit = 26) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['evo_rating_snapshots', userId, limit],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('evo_rating_snapshots')
        .select('id,raw_rating,displayed_rating,evolution_progress,size_score,aesthetics_score,strength_score,cardio_score,confidence,descriptor,trigger_type,changes,recommendations,calculated_at')
        .order('calculated_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePendingEvoEvidence() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['pending_evo_evidence', userId],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_evo_evidence')
        .select('id,pillar,source_type,projected_impact_low,projected_impact_high,reason,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePlayerStats() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['player_stats', userId],
    enabled: userId !== null,
    queryFn: async () => {
      const [statsQ, traitsQ] = await Promise.all([
        supabase.from('player_stats').select('power,vitality,stamina,balance,technique,evo_class').limit(1),
        supabase.from('player_traits').select('trait_key,trait_tier,source_pillar').order('unlocked_at', { ascending: false }),
      ]);
      if (statsQ.error) throw statsQ.error;
      return { stats: statsQ.data?.[0] ?? null, traits: traitsQ.data ?? [] };
    },
  });
}

/** Fire when due (the caller checks the flag). Invalidates the reads. */
export function useRunEvoReview() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: (opts: { force?: boolean } = {}) =>
      runDueEvoReview(supabase, {
        ...opts,
        cachedWorkoutRows: queryClient.getQueryData(['workout_log', userId]) as
          | Record<string, unknown>[]
          | undefined,
      }),
    onSuccess: (result) => {
      if (!result.ran) return;
      void queryClient.invalidateQueries({ queryKey: ['evo_rating_current', userId] });
      void queryClient.invalidateQueries({ queryKey: ['evo_rating_snapshots', userId] });
      void queryClient.invalidateQueries({ queryKey: ['pending_evo_evidence', userId] });
      // AUDIT A5: the review also rewrites player stats/class/traits.
      void queryClient.invalidateQueries({ queryKey: ['player_stats', userId] });
    },
  });
}
