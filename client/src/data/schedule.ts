import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PlanDayValue, ScheduleRow } from '@/domain/scheduled-streak';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';
import { todayIso } from '@/domain/today';

/** IMPROVEMENT_PLAN #11: the weekly schedule rows, oldest first. */
export function useWorkoutSchedule() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['workout_schedule', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ScheduleRow[]> => {
      const { data, error } = await supabase
        .from('workout_schedule')
        .select('effective_from,plan,sources')
        .order('effective_from', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScheduleRow[];
    },
  });
}

/** 065's wire rule: a day with no extras serializes as a PLAIN STRING —
 *  byte-identical to pre-065 rows; only days carrying extras become arrays. */
export function serializePlan(plan: Record<string, PlanDayValue>): Record<string, PlanDayValue> {
  return Object.fromEntries(
    Object.entries(plan).map(([dow, v]) => [
      dow,
      Array.isArray(v) ? (v.length <= 1 ? (v[0] ?? 'Rest') : v) : v,
    ])
  );
}

/** Save today's-onward plan: upsert on (user, effective_from=today). RLS
 *  forbids backdating, so history is judged against what was in force. */
export function useSaveSchedule() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (input: {
      plan: Record<string, PlanDayValue>;
      sources?: Record<string, number>;
    }) => {
      const today = todayIso();
      const { error } = await supabase
        .from('workout_schedule')
        .upsert(
          { effective_from: today, plan: serializePlan(input.plan), sources: input.sources ?? null },
          { onConflict: 'user_id,effective_from' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workout_schedule', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'SCHEDULE SAVED', subtitle: 'Effective today onward' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'SCHEDULE NOT SAVED', subtitle: e.message });
    },
  });
}
