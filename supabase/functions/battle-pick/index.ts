/**
 * battle-pick: the HEADS OR TAILS pick gauntlet (design §16, MG2).
 *
 * Three server-side coin flips, one per step, each rolled with live crypto
 * RNG only when its step opens (nothing to predict, nothing to spoof — the
 * client just replays verdicts):
 *   step 1  flip-1 winner picks the MUSCLE GROUP (PICK_GROUPS allowlist)
 *   step 2  flip-2 winner picks SEAT 1's exercise (inside that group)
 *   step 3  flip-3 winner picks SEAT 2's exercise → round goes LIVE with a
 *           fresh 30-minute window and spec.liveAt (settle only counts
 *           volume from liveAt on, so pick-phase sets can never sneak in).
 *
 * A stalled picker cannot hold the match hostage: once the step deadline
 * passes, EITHER participant may call with {auto:true} and the server makes
 * a random legal pick for the stalled step.
 *
 * Every applied pick is recorded as a battle_events kind='pick' row
 * (service-role write — the 009 guard rejects client 'pick' inserts by
 * construction), which is also what pings realtime for both screens.
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import {
  ENGINE_VERSION,
  HEADS_OR_TAILS_MINUTES,
  PICK_MINUTES,
  pickGroupByKey,
} from '../_shared/battle/engine.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

const randomOf = <T>(items: readonly T[]): T =>
  items[crypto.getRandomValues(new Uint8Array(1))[0] % items.length];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const matchId = String(body.match_id ?? '');
  if (!matchId) return json({ error: 'match_id required.' }, 400);
  const auto = Boolean(body.auto);
  const pick = String(body.pick ?? '');

  const svc = serviceClient();
  const participants = await participantsOf(svc, matchId);
  const me = participants.find((p) => p.user_id === userId);
  if (!me) return json({ error: 'Not your battle.' }, 403);

  const { data: rounds } = await svc
    .from('battle_rounds')
    .select('round_no,kind,spec,status,starts_at,ends_at')
    .eq('match_id', matchId)
    .eq('round_no', 1)
    .limit(1);
  if (!rounds || rounds.length === 0) return json({ error: 'No pick phase to advance.' }, 409);
  const round = rounds[0];
  if (round.kind !== 'heads_or_tails') return json({ error: 'Not a Heads or Tails battle.' }, 409);

  const spec = round.spec as Record<string, unknown>;
  const state = String(spec.state ?? '');
  if (state === 'live') return json({ error: 'Picks are done — the duel is live.' }, 409);
  if (!['awaiting_muscle', 'awaiting_ex_p1', 'awaiting_ex_p2'].includes(state)) {
    return json({ error: `Unknown pick state: ${state}` }, 409);
  }

  const expired = new Date() > new Date(String(round.ends_at));
  const picker = String(spec.picker ?? '');
  if (!expired && picker !== userId) {
    return json({ error: 'Not your pick — the coin said otherwise.' }, 403);
  }
  if (expired && !auto) {
    return json({ error: 'Pick window expired — claim it with auto.', expired: true }, 409);
  }

  // Resolve the value being picked (auto = random legal pick for the step).
  const group = pickGroupByKey(String(spec.muscleGroup ?? ''));
  let value: string;
  if (state === 'awaiting_muscle') {
    const chosen = auto
      ? randomOf(['chest', 'back', 'shoulders', 'arms', 'legs', 'abs'])
      : pick;
    if (!pickGroupByKey(chosen)) return json({ error: `Unknown muscle group: ${chosen}` }, 400);
    value = chosen;
  } else {
    if (!group) return json({ error: 'Pick state is inconsistent (no group).' }, 500);
    const chosen = auto ? randomOf(group.exercises) : pick;
    if (!group.exercises.includes(chosen)) {
      return json({ error: `${chosen} is not a ${group.name} exercise.` }, 400);
    }
    value = chosen;
  }

  // Advance the state machine; flips 2 and 3 are rolled HERE, live.
  const now = new Date();
  const next: Record<string, unknown> = { ...spec, engineVersion: ENGINE_VERSION };
  let newStarts = round.starts_at;
  let newEnds = new Date(now.getTime() + PICK_MINUTES * 60_000).toISOString();
  let step: number;
  if (state === 'awaiting_muscle') {
    step = 1;
    next.muscleGroup = value;
    const face = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0 ? 'heads' : 'tails';
    next.face = face;
    next.picker = participants.find((p) => p.seat === (face === 'heads' ? 1 : 2))!.user_id;
    next.state = 'awaiting_ex_p1';
    next.step = 2;
  } else if (state === 'awaiting_ex_p1') {
    step = 2;
    next.exerciseSeat1 = value;
    const face = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0 ? 'heads' : 'tails';
    next.face = face;
    next.picker = participants.find((p) => p.seat === (face === 'heads' ? 1 : 2))!.user_id;
    next.state = 'awaiting_ex_p2';
    next.step = 3;
  } else {
    step = 3;
    next.exerciseSeat2 = value;
    next.state = 'live';
    next.step = 4;
    next.picker = null;
    next.liveAt = now.toISOString();
    newStarts = now.toISOString();
    newEnds = new Date(now.getTime() + HEADS_OR_TAILS_MINUTES * 60_000).toISOString();
  }

  // CAS on the state we read: two concurrent picks cannot both land.
  const { data: updated, error: uErr } = await svc
    .from('battle_rounds')
    .update({ spec: next, starts_at: newStarts, ends_at: newEnds })
    .eq('match_id', matchId)
    .eq('round_no', 1)
    .eq('spec->>state', state)
    .select('round_no');
  if (uErr) return json({ error: `Could not apply the pick: ${uErr.message}` }, 500);
  if (!updated || updated.length === 0) {
    return json({ error: 'That pick already happened — refresh.' }, 409);
  }

  // Audit + realtime ping (service-role write; clients cannot mint 'pick').
  await svc.from('battle_events').insert({
    match_id: matchId,
    user_id: userId,
    round_no: 1,
    kind: 'pick',
    payload: { step, value, auto, by: userId, next_face: next.face ?? null, state: next.state },
  });

  return json({ applied: true, state: next.state, value });
});
