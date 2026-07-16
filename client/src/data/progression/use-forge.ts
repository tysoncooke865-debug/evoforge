/**
 * PROGRESSION_OVERHAUL P4 — Forge Level + Momentum hooks.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/data/auth-context';
import { useWorkoutLog } from '@/data/hooks';
import { supabase } from '@/data/supabase';
import { forgeProgressFor, type ForgeProgress } from '@/domain/progression/forge-level';
import { computeMomentum, weeksFromHistory, type MomentumState } from '@/domain/progression/momentum';
import { pyFloat } from '@/domain/py';
import { todayIso } from '@/domain/today';

import { migrateForgeHistory } from './award-xp';

export interface ForgeRow {
  forge_level: number;
  lifetime_xp: number;
  weekly_target: number;
  legacy_xp: number | null;
  migration_version: string | null;
}

export function useForgeProgression() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_progression', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ForgeRow | null> => {
      const { data, error } = await supabase
        .from('user_progression')
        .select('forge_level,lifetime_xp,weekly_target,legacy_xp,migration_version')
        .limit(1);
      if (error) throw error;
      return (data?.[0] as ForgeRow) ?? null;
    },
  });
}

/** Level + progress derived by the ONE curve from the cached lifetime XP. */
export function forgeProgressFromRow(row: ForgeRow | null): ForgeProgress {
  return forgeProgressFor(row?.lifetime_xp ?? 0);
}

export function useXpLedger(limit = 30) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['xp_ledger', userId, limit],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('xp_ledger')
        .select('id,event_type,xp_awarded,created_at,source_id')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Momentum derived from the SAME trained-day predicate everything uses. */
export function useMomentum(): { momentum: MomentumState | null; isPending: boolean } {
  const workouts = useWorkoutLog();
  const forge = useForgeProgression();
  if (workouts.isPending || forge.isPending) return { momentum: null, isPending: true };
  const trainedDays = [
    ...new Set(
      (workouts.data ?? [])
        .filter((r) => (pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0)
        .map((r) => String(r.date ?? '').slice(0, 10))
        .filter((d) => d.length === 10)
    ),
  ];
  const target = forge.data?.weekly_target ?? 3;
  const weeks = weeksFromHistory(trainedDays, target, todayIso());
  return { momentum: computeMomentum(weeks), isPending: false };
}

/** The one-shot §43 migration — fire on first flagged launch; rerun-safe. */
export function useForgeMigration() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: () => migrateForgeHistory(supabase),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_progression', userId] });
      void queryClient.invalidateQueries({ queryKey: ['xp_ledger', userId] });
    },
  });
}
