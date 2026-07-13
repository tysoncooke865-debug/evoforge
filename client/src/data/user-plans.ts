import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CustomPlan } from '@/domain/custom-plan';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * TYSON 2026-07-14 — MY PLAN and the AI PLAN are different things.
 *
 * They used to share ONE slot (custom_workout_plan), so forging an AI plan
 * destroyed the split you built by hand, and vice versa. Migration 018 gives
 * each kind its own row, and Train can finally offer all three sources:
 * MY PLAN · AI PLAN · BUILT-IN.
 *
 * custom_workout_plan is still written by the AI path — STREAMLIT READS IT.
 *
 * BACK-COMPAT: an athlete who built a split BEFORE 018 has it in
 * custom_workout_plan and nothing in user_plans. today.tsx handles that: a
 * pre-018 plan whose days are NOT the built-in six can only have come from the
 * routine builder, so it shows as MY PLAN until they save a new one.
 *
 * Reads degrade to null while the table does not exist (deployed-before-
 * migrated), exactly like routines/user_exercises.
 */

export type PlanKind = 'custom' | 'ai';

export interface UserPlanRow {
  id: string;
  kind: PlanKind;
  name: string;
  payload: CustomPlan;
  updated_at: string;
}

export interface UserPlans {
  custom: CustomPlan | null;
  ai: CustomPlan | null;
}

export function useUserPlans() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_plans', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<UserPlans> => {
      try {
        const { data, error } = await supabase
          .from('user_plans')
          .select('id,kind,name,payload,updated_at');
        if (error) return { custom: null, ai: null };
        const rows = (data ?? []) as UserPlanRow[];
        const pick = (kind: PlanKind): CustomPlan | null =>
          rows.find((r) => r.kind === kind)?.payload ?? null;
        return { custom: pick('custom'), ai: pick('ai') };
      } catch {
        return { custom: null, ai: null };
      }
    },
  });
}

/** Write (or replace) one kind's slot. The unique index makes it one per kind:
 *  saving a new hand-built split replaces the old one and CANNOT touch the AI
 *  one — which is the entire point of 018. */
export async function saveUserPlanDirect(kind: PlanKind, plan: CustomPlan): Promise<void> {
  const { error } = await supabase.from('user_plans').upsert(
    {
      kind,
      name: plan.plan_name,
      payload: plan,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,kind' }
  );
  if (error) throw error;
}

export function useSaveUserPlan() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (input: { kind: PlanKind; plan: CustomPlan }) => {
      await saveUserPlanDirect(input.kind, input.plan);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_plans', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'PLAN NOT SAVED', subtitle: e.message });
    },
  });
}
