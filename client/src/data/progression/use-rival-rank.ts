/**
 * PROGRESSION_OVERHAUL P7 — Rival Rank hooks. Standings read the
 * server-written competitive_ratings; unsettled completed battles are
 * reconciled through rival-settle (idempotent — the unique(battle_id)
 * lock makes racing settles harmless).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/data/auth-context';
import { supabase } from '@/data/supabase';

export function useRivalRating() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['competitive_rating', userId],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('competitive_ratings')
        .select('rating,rating_deviation,volatility,placement_matches_completed,season_peak_rating,last_match_at')
        .eq('season_id', 's1')
        .eq('mode', 'overall')
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useRivalMatches(limit = 20) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['competitive_matches', userId, limit],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('competitive_matches')
        .select('id,battle_id,outcome,player_a,player_b,rating_change_a,rating_change_b,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Settle every completed battle that hasn't been rated yet. */
export function useReconcileSettles() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data: battles } = await supabase
        .from('battle_matches')
        .select('id,status')
        .eq('status', 'settled')
        .order('settled_at', { ascending: false })
        .limit(10);
      if (!battles || battles.length === 0) return 0;
      const ids = battles.map((b) => String(b.id));
      const { data: settled } = await supabase
        .from('competitive_matches')
        .select('battle_id')
        .in('battle_id', ids);
      const done = new Set((settled ?? []).map((s) => String(s.battle_id)));
      const pending = ids.filter((id) => !done.has(id));
      if (pending.length === 0) return 0;
      // C6: ONE batched call settles them all (was one round trip each).
      const { data } = await supabase.functions.invoke('rival-settle', {
        body: { battleIds: pending },
      });
      const results = (data as { results?: { settled?: boolean }[] } | null)?.results ?? [];
      return results.filter((r) => r?.settled).length;
    },
    onSuccess: (count) => {
      if (count === 0) return;
      void queryClient.invalidateQueries({ queryKey: ['competitive_rating', userId] });
      void queryClient.invalidateQueries({ queryKey: ['competitive_matches', userId] });
    },
  });
}
