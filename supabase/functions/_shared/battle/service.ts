/**
 * Battle-function plumbing. Two clients, two trust levels:
 *   - the CALLER client (JWT, RLS applies) only proves who is asking;
 *   - the SERVICE client writes the authoritative tables (matches, rounds,
 *     scores, ratings) that deliberately have no client write policies.
 * Every function validates the caller first, then acts with service rights
 * ONLY on rows the validation just tied to that caller.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { callerClient } from '../ai.ts';

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

/** Resolve the caller's user id from the request JWT, or null. */
export async function callerUserId(req: Request): Promise<string | null> {
  const sb = callerClient(req);
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user?.id ?? null;
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

const word = (v: unknown, allowed: readonly string[], fallback: string): string =>
  typeof v === 'string' && allowed.includes(v) ? v : fallback;

/**
 * The participant snapshot: what the OPPONENT gets to see. Client-supplied
 * display stats, server-clamped so nothing exceeds its scale — and stat
 * influence on scoring is already capped at 15% inside the engine, so an
 * inflated snapshot cannot buy a win. Ranked (P4) must recompute this
 * server-side; friendly blitz accepts the clamp. Identity (D4) comes from
 * public_profile, never from the request body.
 */
export function cleanSnapshot(raw: unknown, displayName: string): Record<string, unknown> {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    name: displayName,
    level: num(s.level, 1, 100, 1),
    power: num(s.power, 0, 999, 0),
    strengthScore: num(s.strengthScore, 0, 100, 0),
    conditioningScore: num(s.conditioningScore, 0, 100, 0),
    branch: word(s.branch, ['aesthetic', 'mass', 'hybrid', 'titan', 'cardio', 'shredder'], 'aesthetic'),
    stage: num(s.stage, 1, 4, 1),
    sex: word(s.sex, ['male', 'female'], 'male'),
    characterClass: typeof s.characterClass === 'string' ? String(s.characterClass).slice(0, 40) : 'Rising Aesthetic',
    rating: 1000,
  };
}

/** The D4 gate: battles require the public_profile opt-in display name. */
export async function displayNameOf(svc: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await svc
    .from('public_profile')
    .select('display_name')
    .eq('user_id', userId)
    .limit(1);
  const name = data && data.length > 0 ? data[0].display_name : null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export interface ParticipantRow {
  match_id: string;
  user_id: string;
  seat: number;
  snapshot: Record<string, unknown>;
  ready_at: string | null;
}

export async function participantsOf(svc: SupabaseClient, matchId: string): Promise<ParticipantRow[]> {
  const { data, error } = await svc
    .from('battle_participants')
    .select('match_id,user_id,seat,snapshot,ready_at')
    .eq('match_id', matchId)
    .order('seat');
  if (error || !data) return [];
  return data as ParticipantRow[];
}
