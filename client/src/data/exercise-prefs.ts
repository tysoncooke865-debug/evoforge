import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { siblingNames, type ExercisePref } from '@/domain/exercise-prefs';
import type { WeightUnit } from '@/domain/units';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * Favourites and hidden exercises (migration 019), for the Add Exercise menu.
 *
 * STORED by exercise NAME — `(user_id, exercise)` is the upsert's conflict
 * target and the table's identity, and that does not move: changing it would
 * strand every existing row behind a key nothing looks under.
 *
 * READ by CANONICAL IDENTITY (2026-08-11). A preference is about the
 * EXERCISE, not about the wording that happened to be on screen when it was
 * set. Starring `Bench Press` and then being handed `Bench Press (Strength
 * Focused)` by an AI plan lost the star; worse, the KG⇄LB toggle silently
 * reverted to kg, so an athlete who works in pounds got a card in kilos and
 * typed their next set into it.
 *
 * WRITES KEEP THE SIBLINGS COHERENT. Reading canonically without doing this
 * would introduce a bug worse than the one it fixes: un-starring under a new
 * spelling would write `is_favourite: false` on a NEW row while the old row
 * still said true, the canonical read would still find the true one, and the
 * star would refuse to switch off. So every write applies to the row being
 * named AND to every cached row sharing its identity.
 *
 * Optimistic: starring an exercise mid-workout must feel instant, and the worst
 * case of a failed write is a star that comes back next refetch. Reads degrade
 * to empty while the table is absent.
 */

/** The pure rules live in domain/exercise-prefs.ts — testable without
 *  react-query or react-native. Re-exported so callers keep one import path. */
export {
  isFavourite,
  isHidden,
  prefSets,
  siblingNames,
  unitFor,
  type ExercisePref,
  type PrefSets,
} from '@/domain/exercise-prefs';

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

export function useToggleFavourite() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const key = ['user_exercise_prefs', userId];

  return useMutation({
    mutationFn: async (input: { exercise: string; favourite: boolean }) => {
      // Every spelling of this lift moves together — see the header. Without
      // this, un-starring under a new name leaves an older row still saying
      // `true` and the canonical read keeps the star lit.
      const names = siblingNames(queryClient.getQueryData<ExercisePref[]>(key), input.exercise);
      const stamp = new Date().toISOString();
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        names.map((exercise) => ({ exercise, is_favourite: input.favourite, updated_at: stamp })),
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    // A star is a one-tap gesture mid-set: it must land on the frame it was
    // tapped, not after a round-trip.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ExercisePref[]>(key) ?? [];
      const names = new Set(siblingNames(prev, input.exercise));
      const next = prev.map((p) =>
        names.has(p.exercise) ? { ...p, is_favourite: input.favourite } : p
      );
      if (!prev.some((p) => p.exercise === input.exercise)) {
        next.push({ exercise: input.exercise, is_favourite: input.favourite, is_hidden: false });
      }
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

export function useSetExerciseUnit() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const key = ['user_exercise_prefs', userId];

  return useMutation({
    mutationFn: async (input: { exercise: string; unit: WeightUnit }) => {
      const names = siblingNames(queryClient.getQueryData<ExercisePref[]>(key), input.exercise);
      const stamp = new Date().toISOString();
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        names.map((exercise) => ({ exercise, weight_unit: input.unit, updated_at: stamp })),
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    // The toggle relabels the card the athlete is mid-set on — it must flip on
    // the frame it was tapped, exactly like a favourite star.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ExercisePref[]>(key) ?? [];
      const names = new Set(siblingNames(prev, input.exercise));
      const next = prev.map((p) => (names.has(p.exercise) ? { ...p, weight_unit: input.unit } : p));
      if (!prev.some((p) => p.exercise === input.exercise)) {
        next.push({ exercise: input.exercise, is_favourite: false, is_hidden: false, weight_unit: input.unit });
      }
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
      const cached = queryClient.getQueryData<ExercisePref[]>(['user_exercise_prefs', userId]);
      const names = siblingNames(cached, input.exercise);
      const stamp = new Date().toISOString();
      const { error } = await supabase.from('user_exercise_prefs').upsert(
        names.map((exercise) => ({ exercise, is_hidden: input.hidden, updated_at: stamp })),
        { onConflict: 'user_id,exercise' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_exercise_prefs', userId] });
    },
  });
}
