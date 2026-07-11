import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cardioEventAmount } from '@/domain/cardio';
import { nameError } from '@/domain/leaderboard';
import { safeNum } from '@/domain/physique-ratings';
import { decideSetSave, buildSetRow, type SetInput, type SetVerdict } from '@/domain/set-save';
import { inferMuscleGroup } from '@/domain/workouts';
import { XP_PER_SET } from '@/domain/xp';
import { announceXp, useToastStore } from '@/state/toast-store';

import { runAchievementSweep } from './achievement-sweep';
import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * The write half of save_set_auto(). The pure verdict (domain/set-save.ts)
 * decides; this executes:
 *
 *   update -> PATCH by id. Same id, same ledger grant, NO XP announcement --
 *             correcting a set earns nothing (it never did; the old UI
 *             announced XP here anyway while the derived total stayed put).
 *   insert -> INSERT ... select id, then append the xp_events grant keyed to
 *             the new id. A FAILED GRANT NEVER FAILS THE SAVE -- the set
 *             happened; migrations/002 STEP 3's backfill is re-runnable and
 *             collects orphans. But never silent either: an error toast says
 *             the ledger is behind.
 *
 * Every path invalidates workout_log + xp_total, the invalidate-on-write rule.
 */
export function useSaveSet() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: SetInput): Promise<SetVerdict> => {
      const rows =
        (queryClient.getQueryData(['workout_log', userId]) as
          | import('@/domain/summary').WorkoutRow[]
          | undefined) ?? [];

      const verdict = decideSetSave(rows, input);
      if (verdict.action === 'reject' || verdict.action === 'noop') {
        return verdict;
      }

      const timestamp = new Date().toISOString().slice(0, 19);
      const row = buildSetRow(input, inferMuscleGroup(input.exercise), timestamp);

      if (verdict.action === 'update') {
        const { error } = await supabase.from('workout_log').update(row).eq('id', verdict.rowId);
        if (error) throw error;
        return verdict;
      }

      // insert: user_id comes from DEFAULT auth.uid(), never the payload.
      const { data, error } = await supabase
        .from('workout_log')
        .insert(row)
        .select('id,timestamp')
        .single();
      if (error) throw error;
      verdict.rowId = String(data.id); // the confirmed row, for battle events

      // The grant, keyed to the new row. Idempotence lives in Postgres: the
      // partial unique index on (user_id, source_table, source_id) makes a
      // retry a no-op. The 006 trigger recomputes the amount server-side.
      const { error: grantError } = await supabase.from('xp_events').insert({
        kind: 'set',
        amount: XP_PER_SET,
        source_table: 'workout_log',
        source_id: String(data.id),
        created_at: data.timestamp ?? timestamp,
      });
      if (grantError) {
        useToastStore.getState().push({
          kind: 'error',
          title: 'XP GRANT FAILED',
          subtitle: 'Set saved. Ledger is behind — drift will show until reconciled.',
        });
      }

      return verdict;
    },
    onSuccess: (verdict, input) => {
      queryClient.invalidateQueries({ queryKey: ['workout_log', userId] });
      queryClient.invalidateQueries({ queryKey: ['xp_total', userId] });

      if (verdict.action === 'insert' || verdict.action === 'update') {
        // Fire-and-forget, like Python running the sweep inside the save: a
        // sweep failure must never fail the save. It reads fresh and toasts
        // any unlocks itself.
        void runAchievementSweep(queryClient, userId);
      }

      if (verdict.action === 'insert') {
        // The real value of a set. Announcing more than lands is a lie the bar exposes.
        announceXp(XP_PER_SET);
      }
      if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) {
        useToastStore.getState().push({
          kind: 'pr',
          title: 'NEW PR',
          subtitle: `${input.exercise} — e1RM ${verdict.current1rm.toFixed(1)}kg (prev ${verdict.previousBest.toFixed(1)}kg)`,
        });
      }
    },
    onError: () => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'SAVE FAILED',
        subtitle: 'The set was not stored. Check connection and retry.',
      });
    },
  });
}

export interface CardioInput {
  type: string;
  minutes: number;
  distanceKm: number;
  incline: number;
  speed: number;
  calories: number;
  notes: string;
}

/**
 * save_cardio_row(): insert, then the ledger grant at floor(minutes * 2) --
 * the migrations/002 STEP 3 literal, via cardioEventAmount. A zero amount is
 * refused (check (amount <> 0) would reject it anyway); a failed grant never
 * fails the save but toasts that the ledger is behind. Python's cardio_type
 * column retry is dropped: the live schema has `type` (root CLAUDE.md pins
 * this), and a migration renaming it would break far more than this insert.
 */
export function useLogCardio() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: CardioInput) => {
      const timestamp = new Date().toISOString().slice(0, 19);
      const row = {
        date: timestamp.slice(0, 10),
        type: input.type,
        minutes: safeNum(input.minutes, 0),
        distance_km: safeNum(input.distanceKm, 0),
        incline: safeNum(input.incline, 0),
        speed: safeNum(input.speed, 0),
        calories: safeNum(input.calories, 0),
        notes: input.notes || '',
        timestamp,
      };
      const { data, error } = await supabase
        .from('cardio_log')
        .insert(row)
        .select('id,timestamp')
        .single();
      if (error) throw error;

      const amount = cardioEventAmount(row.minutes);
      if (amount > 0) {
        const { error: grantError } = await supabase.from('xp_events').insert({
          kind: 'cardio',
          amount,
          source_table: 'cardio_log',
          source_id: String(data.id),
          created_at: data.timestamp ?? timestamp,
        });
        if (grantError) {
          useToastStore.getState().push({
            kind: 'error',
            title: 'XP GRANT FAILED',
            subtitle: 'Cardio saved. Ledger is behind — drift will show until reconciled.',
          });
        }
      }
      // rowId rides along so the Battle Arena can reference the confirmed row.
      return { amount, rowId: String(data.id) };
    },
    onSuccess: ({ amount }) => {
      queryClient.invalidateQueries({ queryKey: ['cardio_log', userId] });
      queryClient.invalidateQueries({ queryKey: ['xp_total', userId] });
      if (amount > 0) {
        announceXp(amount, 'CARDIO COMPLETE', 'Session logged');
      }
      void runAchievementSweep(queryClient, userId);
    },
    onError: () => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'SAVE FAILED',
        subtitle: 'The session was not stored. Check connection and retry.',
      });
    },
  });
}

/** Bodyweight is a plain insert -- no XP; the sweep covers bw achievements. */
export function useLogBodyweight() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (bodyweightKg: number) => {
      const timestamp = new Date().toISOString().slice(0, 19);
      const { error } = await supabase.from('bodyweight_log').insert({
        date: timestamp.slice(0, 10),
        bodyweight: bodyweightKg,
        timestamp,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bodyweight_log', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'BODYWEIGHT LOGGED' });
      void runAchievementSweep(queryClient, userId);
    },
    onError: () => {
      useToastStore.getState().push({
        kind: 'error',
        title: 'SAVE FAILED',
        subtitle: 'The reading was not stored.',
      });
    },
  });
}

/** Upsert the caller's opt-in public identity. Mirrors save_public_profile(). */
export function useSavePublicIdentity() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async ({ displayName, isPublic }: { displayName: string | null; isPublic: boolean }) => {
      const problem = nameError(displayName);
      if (problem) throw new Error(problem);
      const name = displayName && displayName.trim() ? displayName.trim() : null;
      const row = {
        display_name: name,
        // Cannot be public without a name to show.
        is_public: Boolean(isPublic) && name !== null,
        updated_at: new Date().toISOString().slice(0, 19),
      };
      const { error } = await supabase.from('public_profile').upsert(row, { onConflict: 'user_id' });
      if (error) {
        const msg = /duplicate|unique/i.test(error.message)
          ? 'That display name is already taken.'
          : error.message;
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public_profile', userId] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard_top', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'PUBLIC IDENTITY SAVED' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
  });
}

/** save_or_update_target(): one live target per (type, name) -- delete then insert. */
export function useSaveTarget() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (t: { targetType: string; name: string; value: number; unit: string; notes?: string }) => {
      await supabase.from('targets').delete().eq('target_type', t.targetType).eq('name', t.name);
      const { error } = await supabase.from('targets').insert({
        target_type: t.targetType,
        name: t.name,
        target_value: t.value,
        unit: t.unit,
        created_at: new Date().toISOString().slice(0, 19),
        notes: t.notes ?? '',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'TARGET SET' });
    },
    onError: () => {
      useToastStore.getState().push({ kind: 'error', title: 'TARGET NOT SAVED' });
    },
  });
}

/** Measurements: plain insert of the tape readings. */
export function useLogMeasurements() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (fields: Record<string, number | string | null>) => {
      const timestamp = new Date().toISOString().slice(0, 19);
      const { error } = await supabase.from('measurements').insert({
        date: timestamp.slice(0, 10),
        ...fields,
        timestamp,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['measurements', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'MEASUREMENTS LOGGED' });
    },
    onError: () => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED' });
    },
  });
}
