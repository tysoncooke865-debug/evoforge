import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UserExercise } from '@/domain/exercise-search';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * PHASE_3 Stage 1 — the athlete's own exercises (migration 016).
 *
 * DEGRADES GRACEFULLY WHILE THE TABLE DOES NOT EXIST: the read returns []
 * on ANY error rather than throwing, so a client deployed ahead of the
 * migration shows the built-in library and nothing breaks. That is safe here
 * in a way it is NOT for the XP ledger — an absent custom-exercise list means
 * "you have made none", which is the same thing the user sees on day one. (A
 * ledger read must return null, never 0, because an absent LEDGER means
 * "unknown", and rendering unknown as zero wipes a character.)
 */

export function useUserExercises() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_exercises', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<UserExercise[]> => {
      try {
        const { data, error } = await supabase
          .from('user_exercises')
          .select('id,name,muscle')
          .order('name', { ascending: true });
        if (error) return [];
        return (data ?? []) as UserExercise[];
      } catch {
        return [];
      }
    },
  });
}

export function useCreateUserExercise() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: { name: string; muscle: string }): Promise<UserExercise> => {
      const name = input.name.trim();
      const { data, error } = await supabase
        .from('user_exercises')
        .insert({ name, muscle: input.muscle })
        .select('id,name,muscle')
        .single();
      if (error) {
        // 016's case-insensitive unique index is the authority on duplicates
        // — the picker's hasExactMatch check is only the fast path.
        if (/duplicate|unique/i.test(error.message)) {
          throw new Error(`"${name}" is already in your exercises.`);
        }
        throw error;
      }
      return data as UserExercise;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['user_exercises', userId] });
      useToastStore.getState().push({
        kind: 'info',
        title: 'EXERCISE CREATED',
        subtitle: `${created.name} · ${created.muscle}`,
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT CREATED', subtitle: e.message });
    },
  });
}
