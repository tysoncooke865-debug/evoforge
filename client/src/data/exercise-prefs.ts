import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { WeightUnit } from '@/domain/units';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * Favourites and hidden exercises (migration 019), for the Add Exercise menu.
 *
 * Keyed by exercise NAME — the same key workout_log has always used. The
 * library has no database ids (it is a bundled constant), and giving it some
 * would mean migrating every historical logged row, which the append-only XP
 * ledger cannot survive: those rows are what granted the XP.
 *
 * Optimistic: starring an exercise mid-workout must feel instant, and the worst
 * case of a failed write is a star that comes back next refetch. Reads degrade
 * to empty while the table is absent.
 */

export interface ExercisePref {
  exercise: string;
  is_favourite: boolean;
  is_hidden: boolean;
  /** KG ⇄ LB (migration 020). Display/input only — the database stays kg. */
  weight_unit?: WeightUnit;
}

export interface PrefSets {
  favourites: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

export function useExercisePrefs() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_exercise_prefs', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ExercisePref[]> => {
      try {
        const { data, error } = await supabase
          .from('user_exercise_prefs')
          .select('exercise,is_favourite,is_hidden,weight_unit');
        if (!error) return (data ?? []) as ExercisePref[];
        // Pre-020 server: the unit column may not exist yet. Favourites and
        // hidden MUST NOT vanish because a newer client asked for one more
        // column — retry with the 019 projection before degrading to empty.
        const fallback = await supabase
          .from('user_exercise_prefs')
          .select('exercise,is_favourite,is_hidden');
        if (fallback.error) return [];
        return (fallback.data ?? []) as ExercisePref[];
      } catch {
        return [];
      }
    },
  });
}

/** Lowercased sets — the ranking engine's key format. */
export function prefSets(rows: ExercisePref[] | undefined): PrefSets {
  const favourites = new Set<string>();
  const hidden = new Set<string>();
  for (const r of rows ?? []) {
    if (r.is_favourite) favourites.add(r.exercise.toLowerCase());
    if (r.is_hidden) hidden.add(r.exercise.toLowerCase());
  }
  return { favourites, hidden };
}

export function useToggleFavourite() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const key = ['user_exercise_prefs', userId];

  return useMutation({
    mutationFn: async (input: { exercise: string; favourite: boolean }) => {
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        {
          exercise: input.exercise,
          is_favourite: input.favourite,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    // A star is a one-tap gesture mid-set: it must land on the frame it was
    // tapped, not after a round-trip.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ExercisePref[]>(key) ?? [];
      const next = prev.some((p) => p.exercise === input.exercise)
        ? prev.map((p) => (p.exercise === input.exercise ? { ...p, is_favourite: input.favourite } : p))
        : [...prev, { exercise: input.exercise, is_favourite: input.favourite, is_hidden: false }];
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** The unit an athlete sees/types for one exercise. Absent row/column = kg. */
export function unitFor(rows: ExercisePref[] | undefined, exercise: string): WeightUnit {
  const row = (rows ?? []).find((r) => r.exercise === exercise);
  return row?.weight_unit === 'lb' ? 'lb' : 'kg';
}

export function useSetExerciseUnit() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const key = ['user_exercise_prefs', userId];

  return useMutation({
    mutationFn: async (input: { exercise: string; unit: WeightUnit }) => {
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        {
          exercise: input.exercise,
          weight_unit: input.unit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    // The toggle relabels the card the athlete is mid-set on — it must flip on
    // the frame it was tapped, exactly like a favourite star.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ExercisePref[]>(key) ?? [];
      const next = prev.some((p) => p.exercise === input.exercise)
        ? prev.map((p) => (p.exercise === input.exercise ? { ...p, weight_unit: input.unit } : p))
        : [
            ...prev,
            { exercise: input.exercise, is_favourite: false, is_hidden: false, weight_unit: input.unit },
          ];
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      useToastStore.getState().push({ kind: 'error', title: 'UNIT NOT SAVED', subtitle: e.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useHideExercise() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (input: { exercise: string; hidden: boolean }) => {
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        { exercise: input.exercise, is_hidden: input.hidden, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_exercise_prefs', userId] });
    },
  });
}
