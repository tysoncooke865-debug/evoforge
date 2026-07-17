import AsyncStorage from '@react-native-async-storage/async-storage';
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
  /** null = an absolute quick-add; 1..N = the meal slot it belongs to. */
  meal_no: number | null;
  /** Grams — present on scanned/looked-up meals, null on manual kcal entries. */
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
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

/**
 * PREVIEW MODE (this branch only, pre-migration): while the nutrition tables
 * do not exist in Supabase, writes divert to ON-DEVICE storage so the page is
 * fully interactive with ZERO database effect — Tyson's "see it without
 * touching prod" requirement. The gate is deliberately NARROW: only the
 * table-does-not-exist error diverts; every other failure still surfaces, so
 * after the migration lands a real outage can never silently hoard entries
 * on the phone. Cleared on sign-out (the every-cache-layer rule).
 */
const PREVIEW_LOG_KEY = 'evoforge-fuel-preview-log-v1';
const PREVIEW_TARGETS_KEY = 'evoforge-fuel-preview-targets-v1';

const tableMissing = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && /42P01|PGRST205|does not exist|schema cache/i.test(`${e.code ?? ''} ${e.message ?? ''}`);

async function readLocal<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function writeLocal<T>(key: string, rows: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(rows));
  } catch {
    // best effort — preview data is disposable by definition
  }
}

export async function clearFuelPreview(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([PREVIEW_LOG_KEY, PREVIEW_TARGETS_KEY]);
  } catch {
    // ignore
  }
}

let previewAnnounced = false;
function announcePreview(): void {
  if (previewAnnounced) return;
  previewAnnounced = true;
  useToastStore.getState().push({
    kind: 'info',
    title: 'PREVIEW MODE',
    subtitle: 'Fuel data saves on this device only — nothing touches your account yet.',
  });
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
          .select('id,date,kcal,label,source,meal_no,protein_g,carbs_g,fat_g,"timestamp"')
          .eq('date', date)
          .order('timestamp', { ascending: true });
        if (error) {
          // Pre-migration: the day lives on the device (PREVIEW MODE).
          if (tableMissing(error))
            return (await readLocal<NutritionEntry>(PREVIEW_LOG_KEY)).filter((e) => e.date === date);
          return [];
        }
        return (data ?? []) as NutritionEntry[];
      } catch {
        return [];
      }
    },
  });
}

/**
 * The distinct dates with ANY logged entry in the trailing window — the
 * streak's input. Reads degrade to empty exactly like the day query; the
 * streak simply shows nothing rather than crashing a pre-migration client.
 */
export function useNutritionDates(today: string, windowDays = 45) {
  const userId = useUserId();
  const since = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString().slice(0, 10);
  })();
  return useQuery({
    queryKey: ['nutrition_dates', userId, today],
    enabled: userId !== null,
    queryFn: async (): Promise<string[]> => {
      try {
        // Newest-first + the ROW_CAP convention: if a heavy logger's window
        // overflows the server cap, truncation drops the OLDEST rows, so the
        // streak shortens at the horizon instead of falsely breaking mid-run.
        const { data, error } = await supabase
          .from('nutrition_log')
          .select('date')
          .gte('date', since)
          .lte('date', today)
          .order('date', { ascending: false })
          .limit(2500);
        if (error) {
          if (tableMissing(error)) {
            const rows = await readLocal<NutritionEntry>(PREVIEW_LOG_KEY);
            return [...new Set(rows.filter((e) => e.date >= since && e.date <= today).map((e) => e.date))];
          }
          return [];
        }
        return [...new Set((data ?? []).map((r) => String((r as { date: string }).date)))];
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
    mutationFn: async (input: { date: string; kcal: number; label: string | null; mealNo?: number | null }) => {
      const { error } = await supabase
        .from('nutrition_log')
        .insert({
          date: input.date,
          kcal: input.kcal,
          label: input.label,
          source: 'manual',
          meal_no: input.mealNo ?? null,
        });
      if (error) {
        // PREVIEW MODE: no table yet → the entry lives on the device.
        if (tableMissing(error)) {
          const rows = await readLocal<NutritionEntry>(PREVIEW_LOG_KEY);
          rows.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            date: input.date,
            kcal: input.kcal,
            label: input.label,
            source: 'manual',
            meal_no: input.mealNo ?? null,
            timestamp: new Date().toISOString(),
          });
          await writeLocal(PREVIEW_LOG_KEY, rows);
          announcePreview();
          return;
        }
        throw error;
      }
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
        meal_no: input.mealNo ?? null,
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
      void queryClient.invalidateQueries({ queryKey: ['nutrition_dates', userId] });
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
      // PREVIEW MODE rows live on the device — delete them there.
      if (entry.id.startsWith('local-')) {
        const rows = await readLocal<NutritionEntry>(PREVIEW_LOG_KEY);
        await writeLocal(
          PREVIEW_LOG_KEY,
          rows.filter((r) => r.id !== entry.id)
        );
        return;
      }
      const { error } = await supabase.from('nutrition_log').delete().eq('id', entry.id);
      if (error) throw error;
    },
    onSuccess: (_d, entry) => {
      void queryClient.invalidateQueries({ queryKey: ['nutrition_log', userId, entry.date] });
      void queryClient.invalidateQueries({ queryKey: ['nutrition_dates', userId] });
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
        if (error) {
          if (tableMissing(error)) {
            const rows = await readLocal<NutritionTargetRow>(PREVIEW_TARGETS_KEY);
            return rows.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
          }
          return [];
        }
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
      if (error) {
        // PREVIEW MODE: the target lives on the device, same upsert semantics.
        if (tableMissing(error)) {
          const rows = await readLocal<NutritionTargetRow>(PREVIEW_TARGETS_KEY);
          const next = rows.filter((r) => r.effective_from !== input.effectiveFrom);
          next.push({
            id: `local-${Date.now()}`,
            effective_from: input.effectiveFrom,
            daily_kcal: input.dailyKcal,
            goal: input.goal,
            inputs: input.inputs,
          });
          await writeLocal(PREVIEW_TARGETS_KEY, next);
          announcePreview();
          return;
        }
        throw error;
      }
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

// ---- MEAL SCAN (2026-07-18): the photo calorie calculator. The meal-scan
// edge fn identifies foods + estimates grams; factors are DETERMINISTIC
// (curated per-100g table, AI estimate only as a flagged fallback). The maths
// below mirrors the server exactly, so corrections recompute identically. ----

export interface MealItem {
  name: string;
  grams: number;
  per100: { kcal: number; p: number; c: number; f: number };
  source: 'db' | 'ai';
  matched: string | null;
}

export interface MealTotals {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure multiplication — identical to the edge function's computation. */
export function scanTotals(items: MealItem[]): MealTotals {
  return items.reduce(
    (t, it) => ({
      kcal: t.kcal + Math.round((it.grams * it.per100.kcal) / 100),
      p: round1(t.p + (it.grams * it.per100.p) / 100),
      c: round1(t.c + (it.grams * it.per100.c) / 100),
      f: round1(t.f + (it.grams * it.per100.f) / 100),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
}

export async function scanMeal(image: string): Promise<{ items: MealItem[]; notes: string } | { error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('meal-scan', { body: { image } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json().catch(() => null);
        return { error: body?.error ?? error.message };
      }
      return { error: error.message };
    }
    if (data?.error) return { error: String(data.error) };
    const r = data?.result as { items: MealItem[]; notes: string } | undefined;
    if (!r?.items?.length) return { error: 'No foods identified.' };
    return { items: r.items, notes: r.notes ?? '' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The scan failed.' };
  }
}

/** Save a corrected, confirmed meal — kcal + macros + full item provenance. */
export function useLogMeal() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: { date: string; items: MealItem[]; mealNo?: number | null }) => {
      const t = scanTotals(input.items);
      // Mirror 037/043's CHECKs and REFUSE rather than clamp — a silently
      // clamped kcal would disagree with the stored items it claims to sum.
      if (t.kcal < 1 || t.kcal > 6000 || t.p > 1000 || t.c > 1500 || t.f > 600)
        throw new Error('Meals cap at 6,000 kcal (P 1000 · C 1500 · F 600). Split it into two meals.');
      const label = input.items.map((i) => i.name).join(', ').slice(0, 60);
      const { error } = await supabase.from('nutrition_log').insert({
        date: input.date,
        kcal: t.kcal,
        label,
        source: 'photo',
        meal_no: input.mealNo ?? null,
        protein_g: t.p,
        carbs_g: t.c,
        fat_g: t.f,
        items: input.items,
      });
      if (error) throw error;
      return t;
    },
    onSuccess: (t, input) => {
      void queryClient.invalidateQueries({ queryKey: ['nutrition_log', userId, input.date] });
      void queryClient.invalidateQueries({ queryKey: ['nutrition_dates', userId] });
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'MEAL LOGGED',
        subtitle: `${t.kcal} kcal · P${Math.round(t.p)} C${Math.round(t.c)} F${Math.round(t.f)}`,
      });
    },
    onError: (e: Error) =>
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT LOGGED',
        subtitle: e.message.includes('cap') ? e.message : 'Could not save the meal. Try again.',
      }),
  });
}
