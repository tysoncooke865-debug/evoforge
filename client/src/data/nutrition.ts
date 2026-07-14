import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Goal, TargetInputs } from '@/domain/nutrition';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * FUEL — the data seams (migration 020; nutrition branch).
 *
 * Reads DEGRADE TO EMPTY while the tables are absent (the sessions.ts
 * pattern): this branch runs against production Supabase before 020 is
 * applied, and a missing table must read as "nothing logged yet", never as a
 * crash. Writes surface their errors — a failed log is a failed log.
 *
 * Optimistic logging: an entry appends to the cache the moment LOG is tapped
 * (the meter must move under the athlete's thumb), rolls back on error, and
 * reconciles on the next refetch. Temp rows carry a `temp-` id; delete simply
 * refuses them — they are seconds old and about to be replaced by the truth.
 */

export interface NutritionEntry {
  id: string;
  date: string;
  kcal: number;
  label: string | null;
  source: 'manual' | 'photo';
  timestamp: string;
}

export interface NutritionTargetRow {
  id: string;
  effective_from: string;
  daily_kcal: number;
  goal: Goal;
  inputs: Partial<TargetInputs>;
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

export function useNutritionLog(date: string) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['nutrition_log', userId, date],
    enabled: userId !== null,
    queryFn: async (): Promise<NutritionEntry[]> => {
      try {
        const { data, error } = await supabase
          .from('nutrition_log')
          .select('id,date,kcal,label,source,"timestamp"')
          .eq('date', date)
          .order('timestamp', { ascending: true });
        if (error) return []; // pre-020: no table is an empty day, not an outage
        return (data ?? []) as NutritionEntry[];
      } catch {
        return [];
      }
    },
  });
}

export function useLogCalories() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: async (input: { date: string; kcal: number; label: string | null }) => {
      const { error } = await supabase
        .from('nutrition_log')
        .insert({ date: input.date, kcal: input.kcal, label: input.label, source: 'manual' });
      if (error) throw error;
    },
    onMutate: async (input) => {
      const key = ['nutrition_log', userId, input.date];
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<NutritionEntry[]>(key);
      const temp: NutritionEntry = {
        id: `temp-${Date.now()}`,
        date: input.date,
        kcal: input.kcal,
        label: input.label,
        source: 'manual',
        timestamp: new Date().toISOString(),
      };
      queryClient.setQueryData<NutritionEntry[]>(key, [...(before ?? []), temp]);
      return { before, key };
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.before);
      useToastStore.getState().push({ kind: 'error', title: 'NOT LOGGED', subtitle: e.message });
    },
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({ queryKey: ['nutrition_log', userId, input.date] });
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (entry: { id: string; date: string }) => {
      // A temp row has no server twin yet; the refetch below reconciles it.
      if (entry.id.startsWith('temp-')) return;
      const { error } = await supabase.from('nutrition_log').delete().eq('id', entry.id);
      if (error) throw error;
    },
    onSuccess: (_d, entry) => {
      void queryClient.invalidateQueries({ queryKey: ['nutrition_log', userId, entry.date] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT DELETED', subtitle: e.message });
    },
  });
}

/** Every target row, oldest first — effective-dated like workout_schedule. */
export function useNutritionTargets() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['nutrition_targets', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<NutritionTargetRow[]> => {
      try {
        const { data, error } = await supabase
          .from('nutrition_targets')
          .select('id,effective_from,daily_kcal,goal,inputs')
          .order('effective_from', { ascending: true });
        if (error) return [];
        return (data ?? []) as NutritionTargetRow[];
      } catch {
        return [];
      }
    },
  });
}

/** The target in force ON a date: the last row effective on or before it. */
export function targetInForce(
  rows: readonly NutritionTargetRow[],
  date: string
): NutritionTargetRow | null {
  let current: NutritionTargetRow | null = null;
  for (const r of rows) {
    if (r.effective_from <= date) current = r;
    else break;
  }
  return current;
}

/**
 * Save today's-onward target: upsert on (user, effective_from=today), the
 * useSaveSchedule pattern. daily_kcal ALWAYS comes from domain/nutrition.ts's
 * dailyTarget (or the athlete's own manual number) — never from the AI.
 */
export function useSaveTarget() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: {
      effectiveFrom: string;
      dailyKcal: number;
      goal: Goal;
      inputs: Partial<TargetInputs>;
    }) => {
      const { error } = await supabase.from('nutrition_targets').upsert(
        {
          effective_from: input.effectiveFrom,
          daily_kcal: input.dailyKcal,
          goal: input.goal,
          inputs: input.inputs,
        },
        { onConflict: 'user_id,effective_from' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nutrition_targets', userId] });
      useToastStore.getState().push({
        kind: 'info',
        title: 'TARGET SET',
        subtitle: 'Effective today onward',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'TARGET NOT SAVED', subtitle: e.message });
    },
  });
}
