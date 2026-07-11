/**
 * battle-cancel (IMPROVEMENT_PLAN #5): either participant may end a battle
 * that has not settled. Compare-and-set against the status list, so a
 * cancel racing a settle produces exactly one truthful outcome; media
 * cleanup is best-effort (an orphaned object behind the private bucket is
 * unreadable garbage, not a leak). Cancelled battles are XP-inert by
 * construction: nothing is written to xp_events and xp_awarded stays null,
 * so the 009 self-heal branch grants nothing either.
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const matchId = String(body.match_id ?? '');
  if (!matchId) return json({ error: 'match_id required.' }, 400);

  const svc = serviceClient();
  const participants = await participantsOf(svc, matchId);
  if (!participants.some((p) => p.user_id === userId)) {
    return json({ error: 'Not your battle.' }, 403);
  }

  // The CAS: only a live match can flip to abandoned.
  const { data: updated, error } = await svc
    .from('battle_matches')
    .update({ status: 'abandoned', cancelled_by: userId, cancelled_at: new Date().toISOString() })
    .eq('id', matchId)
    .in('status', ['inviting', 'matched', 'active'])
    .select('id');
  if (error) return json({ error: `Could not cancel: ${error.message}` }, 500);

  if (!updated || updated.length === 0) {
    const { data: current } = await svc.from('battle_matches').select('status').eq('id', matchId).limit(1);
    const status = current?.[0]?.status;
    if (status === 'abandoned') return json({ cancelled: true, already: true });
    return json({ error: 'Already settled — the result stands.' }, 409);
  }

  // Best-effort media cleanup: deleted with the match, per the D2 doctrine.
  try {
    const { data: media } = await svc
      .from('battle_media')
      .select('storage_path')
      .eq('match_id', matchId);
    const paths = (media ?? []).map((m) => String(m.storage_path)).filter(Boolean);
    if (paths.length > 0) await svc.storage.from('battle-media').remove(paths);
    await svc.from('battle_media').delete().eq('match_id', matchId);
  } catch {
    // Never fail the cancel over cleanup; a periodic sweep is a later task.
  }

  return json({ cancelled: true });
});
