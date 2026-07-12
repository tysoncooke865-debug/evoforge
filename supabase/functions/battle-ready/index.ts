/**
 * battle-ready: mark the caller ready; when BOTH participants are ready the
 * SERVER rolls Round 1 — the object comes from a hash of the match id (an
 * auditable roll neither player can influence) — and opens the 12-minute
 * blitz window. Clients learn about it through realtime on battle_rounds.
 */

import { CORS_HEADERS, json, sha256Hex } from '../_shared/ai.ts';
import { BATTLE_OBJECTS, ENGINE_VERSION, VOLUME_DUEL_MINUTES } from '../_shared/battle/engine.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

const BLITZ_STRENGTH_MINUTES = 12;

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
  const me = participants.find((p) => p.user_id === userId);
  if (!me) return json({ error: 'Not your battle.' }, 403);

  const { data: matches } = await svc
    .from('battle_matches')
    .select('id,status,format')
    .eq('id', matchId)
    .limit(1);
  if (!matches || matches.length === 0) return json({ error: 'No such battle.' }, 404);
  if (!['matched', 'active'].includes(matches[0].status)) {
    return json({ error: 'This battle is not waiting on ready checks.' }, 409);
  }

  if (!me.ready_at) {
    await svc
      .from('battle_participants')
      .update({ ready_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .eq('user_id', userId);
  }

  const fresh = await participantsOf(svc, matchId);
  const bothReady = fresh.length === 2 && fresh.every((p) => p.ready_at !== null);
  if (!bothReady || matches[0].status !== 'matched') {
    return json({ ready: true, both_ready: bothReady });
  }

  const format = String(matches[0].format ?? 'blitz');
  const startsAt = new Date();
  let kind: string;
  let spec: Record<string, unknown>;
  let minutes: number;
  if (format === 'volume_duel') {
    // No object, no target — the duel is raw output inside the window.
    kind = 'volume_duel';
    minutes = VOLUME_DUEL_MINUTES;
    spec = { engineVersion: ENGINE_VERSION, windowMinutes: VOLUME_DUEL_MINUTES };
  } else {
    // Roll the object from the match id: deterministic, auditable, unbiased-enough.
    const hash = await sha256Hex(matchId);
    const roll = parseInt(hash.slice(0, 8), 16) % BATTLE_OBJECTS.length;
    const object = BATTLE_OBJECTS[roll];
    kind = 'strength';
    minutes = BLITZ_STRENGTH_MINUTES;
    spec = {
      objectKey: object.key,
      targetEffectiveKg: object.blitzTargetKg,
      displayKg: object.displayKg,
      engineVersion: ENGINE_VERSION,
      roll_seed: hash.slice(0, 8),
    };
  }
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

  const { error: rErr } = await svc.from('battle_rounds').insert({
    match_id: matchId,
    round_no: 1,
    kind,
    spec,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: 'open',
  });
  if (rErr && !/duplicate|unique/i.test(rErr.message)) {
    return json({ error: `Could not open round 1: ${rErr.message}` }, 500);
  }

  await svc
    .from('battle_matches')
    .update({ status: 'active', current_round: 1 })
    .eq('id', matchId)
    .eq('status', 'matched');

  return json({ ready: true, both_ready: true, round_open: true });
});
