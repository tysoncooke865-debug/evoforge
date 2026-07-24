import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cardioEventAmount } from '@/domain/cardio';
// muscle-lookup, NOT exercise-library/-search: those drag the full ~1,100-entry
// library into the shared boot chunk (perf, 2026-07-23).
import { libraryMuscleFor, userMuscleFor, type UserExercise } from '@/domain/muscle-lookup';
import { nameError } from '@/domain/leaderboard';
import { safeNum } from '@/domain/physique-ratings';
import { decideSetSave, buildSetRow, type SetInput, type SetVerdict } from '@/domain/set-save';
import { localIso } from '@/domain/today';
import { kgToLb } from '@/domain/units';
import { inferMuscleGroup } from '@/domain/workouts';
import { XP_PER_SET } from '@/domain/xp';
import { announceXp, useToastStore } from '@/state/toast-store';

import * as Crypto from 'expo-crypto';

import { runAchievementSweep } from './achievement-sweep';
import { markActivationStep } from './activation';
import { invalidateTable } from './keys';
import { useAuth } from './auth-context';
import { fetchWorkoutLog } from './hooks';
import { enqueueSet } from './set-queue';
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
    mutationFn: async (input: SetInput & { durable?: boolean }): Promise<SetVerdict> => {
      // An ABSENT cache is not an EMPTY log: deciding against [] classifies
      // an existing set as new — duplicate row + second XP grant. Fall back
      // to a fresh read exactly like Python's save_set_auto() did.
      let rows = queryClient.getQueryData(['workout_log', userId]) as
        | import('@/domain/summary').WorkoutRow[]
        | undefined;
      if (rows === undefined) rows = await fetchWorkoutLog();

      const verdict = decideSetSave(rows, input);
      if (verdict.action === 'reject' || verdict.action === 'noop') {
        return verdict;
      }

      // ACTIVATION FUNNEL step 4 — the terminal step, and the only one that
      // matters on its own. Decided HERE because `rows` (the athlete's whole
      // log, cache or fresh read) is only in scope here; emitted in onSuccess
      // so a failed write never reports an activation. An empty log is what
      // makes this the FIRST set: a returning athlete on a new device has rows
      // and stays silent, even though their local mark is gone.
      (verdict as SetVerdict & { firstEver?: boolean }).firstEver = rows.length === 0;

      const timestamp = new Date().toISOString().slice(0, 19);
      // STAGE 1: an exercise the athlete CREATED carries the muscle they
      // chose; everything else infers, exactly as before (inferMuscleGroup is
      // parity-pinned and must not move). Read from the cache — a custom lift
      // must not make LOG SET wait on a network round-trip.
      const userExercises =
        (queryClient.getQueryData(['user_exercises', userId]) as UserExercise[] | undefined) ?? [];
      // Precedence: what the ATHLETE said it trains > what the LIBRARY says >
      // what the name heuristic can infer. inferMuscleGroup is parity-pinned
      // and stays the last resort, never the first answer for a name the
      // library already knows.
      const muscle =
        userMuscleFor(input.exercise, userExercises) ??
        libraryMuscleFor(input.exercise) ??
        inferMuscleGroup(input.exercise);
      const row = buildSetRow(input, muscle, timestamp);

      // TRANSFORM P2: durable INSERTS never wait for the network. The row id
      // is minted HERE (idempotency key — a retried insert collides on the
      // PK), the set lands in AsyncStorage within ~ms, the query cache gains
      // the row optimistically, and the queue syncs in the background.
      // Battles keep the direct path: battle_events need a SERVER-confirmed
      // row inside the round window.
      if (input.durable && verdict.action === 'insert') {
        const id = Crypto.randomUUID();
        await enqueueSet(id, {
          workoutDate: input.workoutDate,
          workout: input.workout,
          exercise: input.exercise,
          setNo: input.setNo,
          weight: input.weight,
          reps: input.reps,
        }, timestamp, muscle, verdict.is_pr);
        verdict.rowId = id;
        (verdict as SetVerdict & { queued?: boolean }).queued = true;
        queryClient.setQueryData(
          ['workout_log', userId],
          (old: import('@/domain/summary').WorkoutRow[] | undefined) =>
            old ? [...old, { id, ...row } as unknown as import('@/domain/summary').WorkoutRow] : old
        );
        return verdict;
      }

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
      const queued = Boolean((verdict as SetVerdict & { queued?: boolean }).queued);

      // The set is logged from the athlete's side in BOTH paths — the durable
      // queue is idempotent and syncs behind them — so both count as activated.
      if (verdict.action === 'insert' && (verdict as SetVerdict & { firstEver?: boolean }).firstEver) {
        void markActivationStep(userId, session?.user?.created_at ?? null, 'first_set_logged', {
          durable: queued,
        });
      }

      if (!queued) {
        // A queued insert already updated the cache optimistically; an
        // immediate refetch would DROP the row (the server hasn't seen it
        // yet) and flicker the pips off. Reconciliation happens on the next
        // natural refetch after the queue flushes.
        queryClient.invalidateQueries({ queryKey: ['workout_log', userId] });
        queryClient.invalidateQueries({ queryKey: ['xp_total', userId] });
      }

      if (verdict.action === 'insert' || verdict.action === 'update') {
        // Fire-and-forget, like Python running the sweep inside the save: a
        // sweep failure must never fail the save. C8: the cache supplies the
        // history; the just-saved row rides along explicitly (the fresh-row
        // guarantee the sweep's header demands).
        void runAchievementSweep(queryClient, userId, {
          id: verdict.action === 'insert' || verdict.action === 'update' ? verdict.rowId : undefined,
          date: input.workoutDate,
          workout: input.workout,
          exercise: input.exercise,
          set: input.setNo,
          weight: input.weight,
          reps: input.reps,
        });
      }

      if (verdict.action === 'insert') {
        // The real value of a set. Announcing more than lands is a lie the bar exposes.
        announceXp(XP_PER_SET);
      }
      if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) {
        // The e1RM values are kg (the stored truth); the TOAST paints them in
        // the exercise's unit pref, read best-effort from the cache — a
        // display courtesy, never a stored value.
        const prefRows = queryClient.getQueryData<{ exercise: string; weight_unit?: string }[]>([
          'user_exercise_prefs',
          userId,
        ]);
        const inLb = (prefRows ?? []).some(
          (p) => p.exercise === input.exercise && p.weight_unit === 'lb'
        );
        const fmt = (kg: number) => (inLb ? `${kgToLb(kg).toFixed(1)}lb` : `${kg.toFixed(1)}kg`);
        useToastStore.getState().push({
          kind: 'pr',
          title: 'NEW PR',
          subtitle: `${input.exercise} — e1RM ${fmt(verdict.current1rm)} (prev ${fmt(verdict.previousBest)})`,
        });
        // RIVALRY (072): if this PR passes a friend's best for the lift, they get
        // a "reclaim your status" alert. Fire-and-forget; never blocks the save.
        void import('./social-notifications').then(({ reportPrCrossings }) =>
          reportPrCrossings(input.exercise, verdict.current1rm, verdict.previousBest)
        );
        // Coin claim (IMPROVEMENT_PLAN #12): fire-and-forget; the 013 guard
        // re-proves the PR server-side and the unique index absorbs repeats.
        // QUEUED sets skip this entirely — the row doesn't exist server-side
        // yet (it's still in the AsyncStorage queue), so claiming now races
        // the 013 guard's `workout_log` lookup and loses almost every time
        // ("no matching owned set", surfaced as a false COINS NOT BANKED
        // error, 2026-07-24). set-queue.ts's flushQueue claims it instead,
        // right after ITS insert is confirmed.
        const prRowId = verdict.action === 'insert' ? verdict.rowId : verdict.rowId ?? undefined;
        if (prRowId && !queued) {
          void import('./coins').then(({ claimCoin }) =>
            claimCoin('pr', prRowId).then((result) => {
              if (result.outcome === 'landed') {
                invalidateTable(queryClient, 'coin_events'); // total AND /coins history (A5)
                useToastStore.getState().push({ kind: 'info', title: 'COINS BANKED +50', subtitle: 'Personal record' });
              }
            })
          );
        }
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
  /** 057 (2026-07-19): whether Fuel eats these calories back into the day's
   *  budget. Omitted = true (every pre-dialog path keeps old behaviour). */
  countTowardBudget?: boolean;
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
      // The CALENDAR day is local (domain/today's rule — a session happens on
      // the day the athlete says); the timestamp stays UTC. cardio_log.date
      // was the odd one out writing the UTC day, so an evening session west of
      // Greenwich filed under tomorrow and every day-boundary stat missed it.
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19);
      const row = {
        date: localIso(now),
        type: input.type,
        minutes: safeNum(input.minutes, 0),
        distance_km: safeNum(input.distanceKm, 0),
        incline: safeNum(input.incline, 0),
        speed: safeNum(input.speed, 0),
        calories: safeNum(input.calories, 0),
        count_toward_budget: input.countTowardBudget ?? true,
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
      queryClient.invalidateQueries({ queryKey: ['cardio_calories', userId] });
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
      // The CALENDAR day is LOCAL (domain/today's rule), like the cardio path.
      // Writing timestamp.slice(0,10) filed the UTC day, so a reading logged in
      // the evening west of Greenwich (or early morning east of it) landed on
      // the wrong day — and "latest bodyweight", the streak and every
      // day-boundary stat then read the wrong value.
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19);
      const { error } = await supabase.from('bodyweight_log').insert({
        date: localIso(now),
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

/**
 * Update the athlete's training numbers on their profile row (the 008
 * columns). base_level is deliberately NOT editable — placement is decided
 * once, at onboarding; these fields only feed the live stat engine.
 */
export function useUpdateTrainingNumbers() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (fields: { deadliftE1rm?: number | null; nutritionPhase?: string; heightCm?: number }) => {
      const row: Record<string, unknown> = {};
      if ('deadliftE1rm' in fields) row.deadlift_e1rm = fields.deadliftE1rm;
      if (fields.nutritionPhase) row.nutrition_phase = fields.nutritionPhase;
      if (fields.heightCm && fields.heightCm > 0) row.height_cm = fields.heightCm;
      if (Object.keys(row).length === 0) return;
      const { error, count } = await supabase
        .from('profile')
        .update(row, { count: 'exact' })
        .eq('user_id', userId!);
      if (error) throw error;
      if ((count ?? 0) === 0) throw new Error('No profile row to update.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'TRAINING NUMBERS SAVED' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
  });
}

/**
 * Accept an AI plan: plans are user-owned CONFIG, not history — the
 * user_plans upsert replaces the 'ai' slot whole (018's unique(user_id,
 * kind)). 062 retired the legacy custom_workout_plan double-write.
 */
export function useAcceptPlan() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (plan: import('@/domain/custom-plan').CustomPlan) => {
      // 062 (2026-07-19): user_plans kind='ai' is THE home. The legacy
      // custom_workout_plan double-write is retired (Streamlit, its only
      // reader, is gone; the migration one-shot-copied surviving plans).
      const { saveUserPlanDirect } = await import('./user-plans');
      await saveUserPlanDirect('ai', plan);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_plans', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'ROUTINE FORGED', subtitle: 'Find it on Train under AI PLAN' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'PLAN NOT SAVED', subtitle: e.message });
    },
  });
}

/** Drop the active AI plan; Today falls back to the built-in routine.
 *  062: deletes the ONE home (user_plans 'ai') — the old version deleted
 *  only the legacy table, so a "discarded" AI plan kept showing on Train
 *  (audit bug A3). Legacy rows are swept too, belt-and-braces. */
export function useDiscardPlan() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('user_plans').delete().eq('kind', 'ai');
      if (error) throw error;
      // Legacy sweep — harmless if already empty; never blocks the discard.
      await supabase.from('custom_workout_plan').delete().not('id', 'is', null).then(
        () => undefined,
        () => undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_plans', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'AI PLAN REMOVED' });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT REMOVED', subtitle: e.message });
    },
  });
}

/** Upsert the caller's opt-in public identity. Mirrors save_public_profile(). */
export function useSavePublicIdentity() {
  const queryClient = useQueryClient();

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
      // AUDIT A5: the display name feeds EVERY social read surface, not just
      // the two this screen shows. One helper, every reader (keys.ts).
      invalidateTable(queryClient, 'public_profile');
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
      queryClient.invalidateQueries({ queryKey: ['measurements_latest', userId] });
      useToastStore.getState().push({ kind: 'info', title: 'MEASUREMENTS LOGGED' });
    },
    onError: () => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED' });
    },
  });
}
