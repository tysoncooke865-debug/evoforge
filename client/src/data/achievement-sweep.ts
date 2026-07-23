import type { QueryClient } from '@tanstack/react-query';

import { sweepAchievements, type SweepInputs } from '@/domain/achievements';
import { muscleHeatMap } from '@/domain/avatar-stats-calc';
import { ACHIEVEMENTS } from '@/domain/catalogs';
import { pyFloat } from '@/domain/py';
import { workoutSummary, type CardioRow, type WorkoutRow } from '@/domain/summary';
import { useToastStore } from '@/state/toast-store';

import { supabase } from './supabase';

/**
 * The write half of check_achievements(): one sweep, ONE batch insert, and
 * never claim an unlock the database refused. Runs after every set save,
 * like Python.
 *
 * NETWORK BUDGET (perf, 2026-07-23 — this used to be ~7 round-trips PER SET,
 * the single largest network cost of an active workout):
 *  - `achievements` (the held set) and `xp_total` are ALWAYS fresh — the
 *    held set is what makes the insert honest (a stale one re-claims), and
 *    both are tiny reads.
 *  - Every other input reads the Query cache when it can answer COMPLETELY,
 *    and falls back to a fresh fetch when it can't (absent, or a windowed
 *    cache that may truncate history — bodyweight's 180-row window). The C8
 *    precedent: caches only ever LAG reality, so a cache-fed sweep can fire
 *    an unlock LATE (the next sweep lands it), never wrongly.
 *  - Concurrent calls COALESCE: a burst of saves runs one sweep now and one
 *    after, not one each. The trailing sweep reads the cache the burst's
 *    optimistic patches already updated.
 */

let inFlight = false;
let trailing: { queryClient: QueryClient; userId: string | null; justSaved?: WorkoutRow } | null =
  null;

export async function runAchievementSweep(
  queryClient: QueryClient,
  userId: string | null,
  /** C8: the row the caller JUST wrote — appended when the cache hasn't
   *  refetched yet, so the fresh-row guarantee survives the cache reuse. */
  justSaved?: WorkoutRow
) {
  if (inFlight) {
    // Keep the LATEST just-saved row; earlier burst rows are already in the
    // cache (the durable path patches it optimistically) or in the fresh read.
    trailing = { queryClient, userId, justSaved };
    return;
  }
  inFlight = true;
  try {
    await sweepOnce(queryClient, userId, justSaved);
  } catch {
    // A sweep failure must never surface as a save failure — the set landed.
  } finally {
    inFlight = false;
    if (trailing) {
      const next = trailing;
      trailing = null;
      void runAchievementSweep(next.queryClient, next.userId, next.justSaved);
    }
  }
}

async function sweepOnce(queryClient: QueryClient, userId: string | null, justSaved?: WorkoutRow) {
  const cachedRows = queryClient.getQueryData(['workout_log', userId]) as WorkoutRow[] | undefined;
  // Cache-first inputs. Shapes are the hooks' own (hooks.ts/oracle-history.ts);
  // each fallback is the sweep's original fresh read, byte-identical.
  const bwCache = queryClient.getQueryData(['bodyweight_log', userId]) as
    | { bodyweight: number }[]
    | undefined;
  const bfCache = queryClient.getQueryData(['bodyfat_history', userId]) as
    | { bf_mid: number | null }[]
    | undefined;
  const cardioCache = queryClient.getQueryData(['cardio_log', userId]) as CardioRow[] | undefined;
  const targetsCache = queryClient.getQueryData(['targets', userId]) as
    | { target_type: string; name: string; target_value: number }[]
    | undefined;
  // useProfile caches the LATEST row (or null — a real "no profile yet");
  // only `undefined` means the cache can't answer.
  const profileCache = queryClient.getQueryData(['profile', userId]) as
    | { base_level?: unknown }
    | null
    | undefined;

  const [ach, workouts, bws, bfs, cardio, targets, profile, ledger] = await Promise.all([
    supabase.from('achievements').select('achievement_id').limit(2500),
    cachedRows !== undefined
      ? Promise.resolve({ data: cachedRows, error: null })
      : supabase
          .from('workout_log')
          .select('id,date,workout,exercise,set,weight,reps,timestamp')
          .order('timestamp', { ascending: true })
          .limit(2500),
    // The bodyweight cache is a NEWEST-180 window (hooks.ts B7): it can only
    // stand in for the full table when it holds fewer than 180 rows — i.e.
    // when the window IS the whole history. min/max/count over a truncated
    // window would silently miss weight-change unlocks.
    bwCache !== undefined && bwCache.length < 180
      ? Promise.resolve({ data: bwCache, error: null })
      : supabase.from('bodyweight_log').select('id,bodyweight,timestamp').order('timestamp', { ascending: true }).limit(2500),
    bfCache !== undefined
      ? Promise.resolve({ data: bfCache, error: null })
      : supabase.from('bodyfat_log').select('id,bf_mid,timestamp').order('timestamp', { ascending: true }).limit(2500),
    cardioCache !== undefined
      ? Promise.resolve({ data: cardioCache, error: null })
      : supabase.from('cardio_log').select('id,date,type,minutes,distance_km,timestamp').order('timestamp', { ascending: true }).limit(2500),
    targetsCache !== undefined
      ? Promise.resolve({ data: targetsCache, error: null })
      : supabase.from('targets').select('target_type,name,target_value,created_at').order('created_at', { ascending: true }).limit(2500),
    profileCache !== undefined
      ? Promise.resolve({ data: profileCache === null ? [] : [profileCache], error: null })
      : supabase.from('profile').select('base_level,created_at').order('created_at', { ascending: true }).limit(2500),
    supabase.rpc('xp_total'),
  ]);
  if (ach.error || workouts.error) return; // no data, no sweep — never guess

  const held = new Set((ach.data ?? []).map((r) => String(r.achievement_id)));
  let rows = (workouts.data ?? []) as WorkoutRow[];
  if (justSaved && !rows.some((r) => r.id !== undefined && r.id === justSaved.id)) {
    rows = [...rows, justSaved];
  }
  const cardioRows = (cardio.data ?? []) as CardioRow[];

  const baseLevel =
    profile.data && profile.data.length > 0
      ? Number(profile.data[profile.data.length - 1].base_level) || 1
      : 1;
  // A real 0 (ledger readable and empty) must stay 0 — `|| null` turned it
  // into "failure", the exact null/0 conflation the XP contract forbids.
  const ledgerN = Number(ledger.data);
  const ledgerXp =
    ledger.error || ledger.data === null || ledger.data === undefined || !Number.isFinite(ledgerN)
      ? null
      : Math.trunc(ledgerN);

  const summary = workoutSummary(rows, cardioRows, ledgerXp, baseLevel);

  const bwVals = (bws.data ?? []).map((r) => pyFloat(r.bodyweight) ?? 0).filter((v) => v > 0);
  const bfVals = (bfs.data ?? []).map((r) => pyFloat(r.bf_mid) ?? 0).filter((v) => v > 0);
  const minutes = cardioRows.reduce((a, r) => a + (pyFloat(r.minutes) ?? 0), 0);
  const distance = cardioRows.reduce(
    (a, r) => a + (pyFloat((r as Record<string, unknown>).distance_km) ?? 0),
    0
  );

  const bfTargetRows = (targets.data ?? []).filter(
    (t) => String(t.target_type) === 'Body Fat' && String(t.name) === 'Body Fat %'
  );
  const bfTarget =
    bfTargetRows.length > 0
      ? (pyFloat(bfTargetRows[bfTargetRows.length - 1].target_value) ?? null)
      : null;

  const inputs: SweepInputs = {
    workoutRows: rows,
    totalSets: summary.totalSets,
    bestBench1rm: summary.bestBench1rm,
    level: summary.level,
    heat: muscleHeatMap(rows),
    bw: {
      latest: bwVals.length > 0 ? bwVals[bwVals.length - 1] : null,
      min: bwVals.length > 0 ? Math.min(...bwVals) : null,
      max: bwVals.length > 0 ? Math.max(...bwVals) : null,
      count: bwVals.length,
    },
    bf: { latest: bfVals.length > 0 ? bfVals[bfVals.length - 1] : null, count: bfVals.length },
    cardio: {
      minutes,
      distance,
      count: cardioRows.length,
      types: new Set(cardioRows.map((r) => String(r.type ?? '')).filter((t) => t !== '')),
    },
    bfTarget,
  };

  const pendingIds = sweepAchievements(inputs, held);
  if (pendingIds.length === 0) return;

  const now = new Date().toISOString().slice(0, 19);
  const insertRows = pendingIds.map((id) => ({
    achievement_id: id,
    name: ACHIEVEMENTS[id][0],
    description: ACHIEVEMENTS[id][1],
    date_unlocked: now,
  }));

  const { error } = await supabase.from('achievements').insert(insertRows);
  if (error) {
    // Idempotent: held-set excludes anything that did land; the next save
    // retries the rest. Claim nothing the database never accepted.
    return;
  }

  queryClient.invalidateQueries({ queryKey: ['achievements', userId] });
  for (const id of pendingIds) {
    useToastStore.getState().push({
      kind: 'achievement',
      title: 'ACHIEVEMENT UNLOCKED',
      subtitle: ACHIEVEMENTS[id][0],
    });
  }
}
