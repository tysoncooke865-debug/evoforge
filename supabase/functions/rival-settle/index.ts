/**
 * rival-settle: PROGRESSION_OVERHAUL P7 — the authoritative Rival Rank
 * settle. A completed BLITZ battle is the match evidence; this function
 * verifies it server-side and applies Glicko-2 to BOTH players.
 *
 * THE RULES (spec §22): only match RESULTS move Rival Rank — never Evo
 * Rating, Forge Level, workouts, coins or cosmetics. Idempotent by the
 * unique(battle_id) lock on competitive_matches: settling twice returns
 * the first settle. Ratings write via service role; clients cannot write
 * competitive_ratings at all (RLS has no client write policy).
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { serviceClient, callerUserId } from '../_shared/battle/service.ts';
import { GLICKO_DEFAULT, glicko2Update, type GlickoRating } from '../_shared/rival/glicko2.ts';

const SEASON = 's1';
const MODE = 'overall';
const RULES_VERSION = '1.0.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const uid = await callerUserId(req);
  if (!uid) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  // C6 (2026-07-19): BATCH — one call settles up to 10 battles instead of
  // one round trip each. `battleId` (singular) stays accepted for compat.
  const rawIds: unknown[] = Array.isArray(body?.battleIds) ? body.battleIds : body?.battleId ? [body.battleId] : [];
  const battleIds = rawIds.map(String).filter(Boolean).slice(0, 10);
  if (battleIds.length === 0) return json({ error: 'battleId or battleIds is required.' }, 400);

  const svc = serviceClient();

  const settleOne = async (battleId: string): Promise<Record<string, unknown>> => {
  // The battle must be genuinely settled, and the caller a participant.
  const { data: matches } = await svc
    .from('battle_matches')
    .select('id,status,winner_user_id,season_id')
    .eq('id', battleId)
    .limit(1);
  const match = matches?.[0];
  if (!match || match.status !== 'settled') {
    return { battleId, error: 'That battle is not settled.' };
  }
  const { data: parts } = await svc
    .from('battle_participants')
    .select('user_id,seat')
    .eq('match_id', battleId)
    .order('seat');
  if (!parts || parts.length !== 2) return { battleId, error: 'Malformed battle.' };
  const [a, b] = parts;
  if (uid !== a.user_id && uid !== b.user_id) {
    return { battleId, error: 'Only a participant can settle a battle.' };
  }

  const outcome: 'a' | 'b' | 'draw' =
    match.winner_user_id === a.user_id ? 'a' : match.winner_user_id === b.user_id ? 'b' : 'draw';
  const scoreA = outcome === 'a' ? 1 : outcome === 'draw' ? 0.5 : 0;

  const loadRating = async (userId: string): Promise<GlickoRating & { placements: number; peak: number }> => {
    const { data } = await svc
      .from('competitive_ratings')
      .select('rating,rating_deviation,volatility,placement_matches_completed,season_peak_rating')
      .eq('user_id', userId)
      .eq('season_id', SEASON)
      .eq('mode', MODE)
      .limit(1);
    const row = data?.[0];
    if (!row) return { ...GLICKO_DEFAULT, placements: 0, peak: GLICKO_DEFAULT.rating };
    return {
      rating: Number(row.rating),
      rd: Number(row.rating_deviation),
      volatility: Number(row.volatility),
      placements: Number(row.placement_matches_completed),
      peak: Number(row.season_peak_rating),
    };
  };

  const ra = await loadRating(a.user_id);
  const rb = await loadRating(b.user_id);

  // THE IDEMPOTENCY LOCK: claim the battle before touching ratings.
  const newA = glicko2Update(ra, [{ opponentRating: rb.rating, opponentRd: rb.rd, score: scoreA }]);
  const newB = glicko2Update(rb, [{ opponentRating: ra.rating, opponentRd: ra.rd, score: 1 - scoreA }]);
  const { error: lockErr } = await svc.from('competitive_matches').insert({
    battle_id: battleId,
    season_id: SEASON,
    mode: MODE,
    player_a: a.user_id,
    player_b: b.user_id,
    outcome,
    rating_change_a: newA.rating - ra.rating,
    rating_change_b: newB.rating - rb.rating,
    player_a_snapshot: { rating: ra.rating, rd: ra.rd },
    player_b_snapshot: { rating: rb.rating, rd: rb.rd },
    scoring_rules_version: RULES_VERSION,
  });
  if (lockErr) {
    if (/duplicate|unique/i.test(lockErr.message)) {
      return { battleId, settled: true, already: true };
    }
    return { battleId, error: `Could not lock the settle: ${lockErr.message}` };
  }

  const writeRating = async (
    userId: string,
    next: GlickoRating,
    prev: { placements: number; peak: number }
  ) => {
    await svc.from('competitive_ratings').upsert(
      {
        user_id: userId,
        season_id: SEASON,
        mode: MODE,
        rating: next.rating,
        rating_deviation: next.rd,
        volatility: next.volatility,
        placement_matches_completed: prev.placements + 1,
        season_peak_rating: Math.max(prev.peak, next.rating),
        last_match_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,season_id,mode' }
    );
  };
  await writeRating(a.user_id, newA, ra);
  await writeRating(b.user_id, newB, rb);

  const mine = uid === a.user_id ? { before: ra.rating, after: newA.rating } : { before: rb.rating, after: newB.rating };
  return {
    battleId,
    settled: true,
    outcome,
    yourRating: { before: Math.round(mine.before), after: Math.round(mine.after) },
  };
  };

  const results: Record<string, unknown>[] = [];
  for (const id of battleIds) {
    try {
      results.push(await settleOne(id));
    } catch (e) {
      results.push({ battleId: id, error: String(e) });
    }
  }
  // Single-id calls keep the old response shape; batch calls get the array.
  if (!Array.isArray(body?.battleIds) && results.length === 1) return json(results[0]);
  return json({ results });
});
