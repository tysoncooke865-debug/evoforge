import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SessionExercise } from '@/domain/session-plan';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * PHASE_3 Stage 1 — saved routines (migration 016).
 *
 * A routine is a SINGLE DAY: "the workout I did, saved to do again". It is
 * NOT a split — multi-day splits live in custom_workout_plan, which Streamlit
 * reads. Starting a routine puts it in the session store and never writes
 * custom_workout_plan, so today's whim cannot overwrite the athlete's plan.
 *
 * Reads degrade to [] while the table does not exist (see data/exercises.ts
 * for why that is safe here and not for the ledger).
 */

export interface RoutinePayload {
  version: 1;
  exercises: SessionExercise[];
}

export interface Routine {
  id: string;
  name: string;
  payload: RoutinePayload;
  created_at: string;
}

export function useRoutines() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['routines', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<Routine[]> => {
      try {
        const { data, error } = await supabase
          .from('routines')
          .select('id,name,payload,created_at')
          .order('created_at', { ascending: false });
        if (error) return [];
        return (data ?? []) as Routine[];
      } catch {
        return [];
      }
    },
  });
}

export function useSaveRoutine() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: { name: string; exercises: SessionExercise[] }): Promise<void> => {
      const name = input.name.trim();
      if (input.exercises.length === 0) throw new Error('Nothing to save — log a set first.');
      const payload: RoutinePayload = { version: 1, exercises: input.exercises };
      const { error } = await supabase.from('routines').insert({ name, payload });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          throw new Error(`You already have a routine called "${name}".`);
        }
        throw error;
      }
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['routines', userId] });
      useToastStore.getState().push({
        kind: 'info',
        title: 'ROUTINE SAVED',
        subtitle: `${input.name.trim()} · ${input.exercises.length} exercises`,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
  });
}

export function useDeleteRoutine() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('routines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routines', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT DELETED', subtitle: e.message });
    },
  });
}
