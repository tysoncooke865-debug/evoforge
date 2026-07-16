/**
 * PROGRESSION_OVERHAUL P4 — the client's side of Forge XP. Event keys are
 * built HERE (one builder per kind — spec §20's idempotency), inserts go
 * through the 023 guard (which re-decides the amount server-side), and
 * server-only kinds go through their RPC claims. Every call is
 * fire-safe: a duplicate key is a silent no-op, never an error surface.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const xpEventKeys = {
  workoutCompleted: (workoutSessionId: string) => `workout_completed:${workoutSessionId}`,
  weeklyTarget: (weekStartIso: string) => `weekly_target:${weekStartIso}`,
  cardioTest: (cardioEvidenceId: string) => `cardio_test:${cardioEvidenceId}`,
  evoScan: (scanId: string) => `evo_scan:${scanId}`,
  weeklyCheckin: (weekStartIso: string) => `weekly_checkin:${weekStartIso}`,
} as const;

/** Client-mintable kinds: the guard clamps the amount; we send 0 and let
 *  the server decide (sending an amount would only invite drift). */
async function insertAward(
  supabase: SupabaseClient,
  eventKey: string,
  eventType: string,
  sourceId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('xp_ledger')
    .insert({ event_key: eventKey, event_type: eventType, source_id: sourceId, xp_awarded: 0 })
    .select('xp_awarded')
    .limit(1);
  if (error) {
    // 23505 = the unique key already granted this exact event. Fine.
    if ((error as { code?: string }).code === '23505') return 0;
    throw error;
  }
  return data?.[0]?.xp_awarded ?? 0;
}

export const awardWorkoutCompleted = (sb: SupabaseClient, sessionId: string) =>
  insertAward(sb, xpEventKeys.workoutCompleted(sessionId), 'workout_completed', sessionId);

/**
 * Award for a finish that just flushed. The queue's insert may have been
 * the winner or a duplicate of an earlier attempt — either way the marker
 * row exists; when the id wasn't returned, look it up. NEVER throws: XP is
 * a bonus on top of a finish, and a failed award must not fail the flush.
 */
export async function awardForFinish(
  sb: SupabaseClient,
  date: string,
  workout: string,
  knownId: string | null
): Promise<void> {
  try {
    let id = knownId;
    if (!id) {
      const { data } = await sb
        .from('workout_sessions')
        .select('id')
        .eq('date', date)
        .eq('workout', workout)
        .limit(1);
      id = (data?.[0]?.id as string | undefined) ?? null;
    }
    if (id) await awardWorkoutCompleted(sb, id);
  } catch {
    // The weekly claim and any later finish re-award via the same key.
  }
}

export const awardCardioTest = (sb: SupabaseClient, evidenceId: string) =>
  insertAward(sb, xpEventKeys.cardioTest(evidenceId), 'cardio_test_completed', evidenceId);

export const awardEvoScan = (sb: SupabaseClient, scanId: string) =>
  insertAward(sb, xpEventKeys.evoScan(scanId), 'evo_scan_completed', scanId);

/** Server-verified weekly claim (250/150 XP) — the RPC re-proves the week. */
export async function claimWeeklyTarget(
  supabase: SupabaseClient,
  weekStartIso: string
): Promise<{ granted: number; reason: string }> {
  const { data, error } = await supabase.rpc('forge_claim_weekly', { p_week_start: weekStartIso });
  if (error) throw error;
  return data as { granted: number; reason: string };
}

/** The §43 one-shot history conversion — rerun-safe by event keys. */
export async function migrateForgeHistory(
  supabase: SupabaseClient
): Promise<{ migrated: number; legacy_xp: number }> {
  const { data, error } = await supabase.rpc('forge_migrate_history');
  if (error) throw error;
  return data as { migrated: number; legacy_xp: number };
}
