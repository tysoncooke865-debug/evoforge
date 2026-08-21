import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { useActivationStep } from '@/data/activation';
import { useClaimCoin, type CoinKind } from '@/data/coins';
import { useSaveSet } from '@/data/mutations';
import {
  useDeleteEntry,
  useLogCalories,
  useSaveTarget,
  type NutritionEntry,
  type NutritionTargetRow,
} from '@/data/nutrition';
import { useFinishWorkout, useReopenWorkout } from '@/data/sessions';
import type { ClaimOutcome } from '@/domain/coin-claims';
import { libraryMuscleFor } from '@/domain/exercise-library';
import { buildSetRow, decideSetSave, type SetInput, type SetVerdict } from '@/domain/set-save';
import type { WorkoutRow } from '@/domain/summary';
import type { SessionMarker } from '@/domain/week-status';
import { inferMuscleGroup } from '@/domain/workouts';
import { announceXp, useToastStore } from '@/state/toast-store';
import { XP_PER_SET } from '@/domain/xp';

import { useLabDataMode } from '../lab-data-provider';
import { LAB_USER_ID } from '../lab-user';

/**
 * The write shims — the reason mock mode is SAFE to interact with.
 *
 * Faking the auth context does NOT make writes safe: the server stamps
 * user_id from auth.uid() (never the payload), and useSaveSet enqueues into
 * the DURABLE AsyncStorage set-queue before any network — so an un-shimmed
 * LOG SET in mock mode would insert a real row under the real account (or
 * strand junk in the queue signed out). These shims write the seeded cache
 * instead: same verdict logic (decideSetSave), same announcements, zero
 * durability, zero network.
 *
 * Each shim calls BOTH hooks unconditionally (rules of hooks) and returns
 * whichever the enclosing LabDataProvider's mode selects — so a fork that
 * swaps its import runs UNCHANGED in real mode.
 *
 * Fork usage (see src/lab/README.md):
 *   import { useLabSaveSet as useSaveSet } from '@/lab/mock/mutations';
 */

/** The activation funnel fires ON MOUNT (useActivationStep), so the banner's
 *  "heed the un-shimmed writes" rule cannot cover it — a mock variant would
 *  emit activation_step into the REAL analytics_events rail under the fake
 *  session (and pollute the funnel whenever a real session sits underneath).
 *  `ready: false` keeps the real hook mounted but permanently inert. */
export function useLabActivationStep(
  ...args: Parameters<typeof useActivationStep>
): ReturnType<typeof useActivationStep> {
  const mode = useLabDataMode();
  const [step, opts] = args;
  useActivationStep(step, mode === 'mock' ? { ...(opts ?? {}), ready: false } : opts ?? {});
}

/** The retroactive starting bonus fires from a MOUNT effect on Home, so it
 *  is in the same class as useActivationStep: the banner's "heed the
 *  un-shimmed writes" rule cannot cover a write the developer never asked
 *  for. Un-shimmed, merely OPENING the Home variant inserts a coin_events
 *  row under whatever session sits underneath the fake one.
 *
 *  The mock answers what the server already would: the lab wallet
 *  (LAB_COIN_TOTAL) includes every bonus the fixture athlete is owed, so
 *  every kind comes back 'duplicate' — which the coins doctrine absorbs
 *  silently, no toast, no invalidation, no network. A variant that wants a
 *  claim to LAND has to teach this shim what landing means; inventing an
 *  amount here would contradict the 013 guard, which recomputes it. */
export function useLabClaimCoin(): ReturnType<typeof useClaimCoin> {
  const real = useClaimCoin();
  const mode = useLabDataMode();

  const mock = useMutation({
    mutationFn: async (_claim: { kind: CoinKind; sourceId: string }): Promise<ClaimOutcome> => ({
      outcome: 'duplicate',
    }),
  });

  return mode === 'mock' ? mock : real;
}

export function useLabSaveSet(): ReturnType<typeof useSaveSet> {
  const real = useSaveSet();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    mutationFn: async (input: SetInput & { durable?: boolean }): Promise<SetVerdict> => {
      const key = ['workout_log', LAB_USER_ID];
      const rows = (queryClient.getQueryData(key) as WorkoutRow[] | undefined) ?? [];
      const verdict = decideSetSave(rows, input);
      if (verdict.action === 'reject' || verdict.action === 'noop') return verdict;

      const timestamp = new Date().toISOString().slice(0, 19);
      const muscle = libraryMuscleFor(input.exercise) ?? inferMuscleGroup(input.exercise);
      const row = buildSetRow(input, muscle, timestamp);

      if (verdict.action === 'update') {
        queryClient.setQueryData(key, (old: WorkoutRow[] | undefined) =>
          (old ?? []).map((r) => (r.id === verdict.rowId ? { ...r, ...row } : r))
        );
        return verdict;
      }

      const id = `lab-${Crypto.randomUUID()}`;
      verdict.rowId = id;
      queryClient.setQueryData(key, (old: WorkoutRow[] | undefined) => [
        ...(old ?? []),
        { id, ...row } as unknown as WorkoutRow,
      ]);
      return verdict;
    },
    onSuccess: (verdict, input) => {
      // Same voice as the real path: a NEW set announces its XP; a PR toasts.
      if (verdict.action === 'insert') announceXp(XP_PER_SET);
      if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) {
        useToastStore.getState().push({
          kind: 'pr',
          title: 'NEW PR',
          subtitle: `${input.exercise} — e1RM ${verdict.current1rm.toFixed(1)}kg (prev ${verdict.previousBest.toFixed(1)}kg)`,
        });
      }
    },
  });

  return mode === 'mock' ? mock : real;
}

export function useLabFinishWorkout(): ReturnType<typeof useFinishWorkout> {
  const real = useFinishWorkout();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    // The context type must match the real hook's (its onMutate returns the
    // rollback snapshot) or the mode-select below fails to typecheck.
    onMutate: async (): Promise<{ prev: SessionMarker[] }> => ({
      prev:
        (queryClient.getQueryData(['workout_sessions', LAB_USER_ID]) as
          | SessionMarker[]
          | undefined) ?? [],
    }),
    mutationFn: async (input: { date: string; workout: string }) => {
      queryClient.setQueryData(
        ['workout_sessions', LAB_USER_ID],
        (old: SessionMarker[] | undefined) => {
          const prev = old ?? [];
          if (prev.some((m) => m.date === input.date && m.workout === input.workout)) return prev;
          return [...prev, { id: `lab-finish-${input.date}-${input.workout}`, ...input }];
        }
      );
    },
  });

  return mode === 'mock' ? mock : real;
}

/** The FUEL target upsert. Mock mirrors the server's (user, effective_from)
 *  conflict rule against the seeded cache and keeps rows ascending (that is
 *  targetInForce's walk order). NO invalidation on purpose: a refetch in
 *  mock mode would replace the seed with an RLS-empty read and blank the
 *  hero mid-comparison. The real hook's toast is replayed so APPLY feels
 *  identical in both modes. */
export function useLabSaveTarget(): ReturnType<typeof useSaveTarget> {
  const real = useSaveTarget();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    mutationFn: async (input: Parameters<ReturnType<typeof useSaveTarget>['mutate']>[0]) => {
      const key = ['nutrition_targets', LAB_USER_ID];
      const rows = (queryClient.getQueryData(key) as NutritionTargetRow[] | undefined) ?? [];
      const next = rows.filter((r) => r.effective_from !== input.effectiveFrom);
      next.push({
        id: `lab-target-${input.effectiveFrom}`,
        effective_from: input.effectiveFrom,
        daily_kcal: input.dailyKcal,
        goal: input.goal,
        inputs: input.inputs,
        kcal_lose: input.triple?.lose ?? null,
        kcal_maintain: input.triple?.maintain ?? null,
        kcal_gain: input.triple?.gain ?? null,
      });
      next.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
      queryClient.setQueryData(key, next);
    },
    onSuccess: () => {
      useToastStore.getState().push({
        kind: 'info',
        title: 'TARGET SET',
        subtitle: 'Effective today onward',
      });
    },
  });

  return mode === 'mock' ? mock : real;
}

export function useLabLogCalories(): ReturnType<typeof useLogCalories> {
  const real = useLogCalories();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    // The context type must match the real hook's (its onMutate returns the
    // optimistic-rollback snapshot) or the mode-select below fails to
    // typecheck — the finish-shim lesson.
    onMutate: async (input): Promise<{ before: NutritionEntry[] | undefined; key: (string | null)[] }> => ({
      before: queryClient.getQueryData<NutritionEntry[]>(['nutrition_log', LAB_USER_ID, input.date]),
      key: ['nutrition_log', LAB_USER_ID, input.date],
    }),
    mutationFn: async (input: { date: string; kcal: number; label: string | null; mealNo?: number | null }) => {
      const key = ['nutrition_log', LAB_USER_ID, input.date];
      const entry: NutritionEntry = {
        id: `lab-nl-${Crypto.randomUUID()}`,
        date: input.date,
        kcal: input.kcal,
        label: input.label,
        source: 'manual',
        meal_no: input.mealNo ?? null,
        timestamp: new Date().toISOString(),
      };
      queryClient.setQueryData(key, (old: NutritionEntry[] | undefined) => [...(old ?? []), entry]);
    },
  });

  return mode === 'mock' ? mock : real;
}

export function useLabDeleteEntry(): ReturnType<typeof useDeleteEntry> {
  const real = useDeleteEntry();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    mutationFn: async (entry: { id: string; date: string }) => {
      const key = ['nutrition_log', LAB_USER_ID, entry.date];
      queryClient.setQueryData(key, (old: NutritionEntry[] | undefined) =>
        (old ?? []).filter((r) => r.id !== entry.id)
      );
    },
  });

  return mode === 'mock' ? mock : real;
}

export function useLabReopenWorkout(): ReturnType<typeof useReopenWorkout> {
  const real = useReopenWorkout();
  const mode = useLabDataMode();
  const queryClient = useQueryClient();

  const mock = useMutation({
    // Same context-shape alignment as the finish shim above.
    onMutate: async (): Promise<{ prev: SessionMarker[] }> => ({
      prev:
        (queryClient.getQueryData(['workout_sessions', LAB_USER_ID]) as
          | SessionMarker[]
          | undefined) ?? [],
    }),
    mutationFn: async (marker: SessionMarker) => {
      queryClient.setQueryData(
        ['workout_sessions', LAB_USER_ID],
        (old: SessionMarker[] | undefined) =>
          (old ?? []).filter((m) => !(m.date === marker.date && m.workout === marker.workout))
      );
      useToastStore.getState().push({
        kind: 'info',
        title: 'REOPENED',
        subtitle: 'Log away — the workout is unlocked.',
      });
    },
  });

  return mode === 'mock' ? mock : real;
}
