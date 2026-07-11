/**
 * battle-settle: the ONLY place a battle is decided. Recomputes both
 * athletes' Round 1 scores from trigger-validated battle_events (the client
 * payloads were discarded at insert; what's scored is what was logged, when
 * it was logged), writes battle_round_scores, picks the winner, and grants
 * ledger XP with the service key. Idempotent: a settled match returns its
 * existing verdict; the 002 unique index makes re-granted XP a no-op.
 *
 * P1 battles are Round 1 only, so settle == settle-round + final verdict.
 * P2 splits round settlement out when rounds 2/3 arrive.
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import {
  battleXp,
  scoreStrengthRound,
  totalEffectiveKg,
  type StrengthSpec,
  type VolumeEvent,
} from '../_shared/battle/engine.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

interface EventRow {
  user_id: string;
  payload: { exercise?: unknown; weight?: unknown; reps?: unknown };
  server_ts: string;
}

const toVolume = (r: EventRow): VolumeEvent => ({
  exercise: String(r.payload.exercise ?? ''),
  weightKg: Number(r.payload.weight ?? 0) || 0,
  reps: Number(r.payload.reps ?? 0) || 0,
  serverTs: r.server_ts,
});

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
  if (participants.length !== 2) return json({ error: 'Battle is not full.' }, 409);

  const { data: matches } = await svc
    .from('battle_matches')
    .select('id,status,winner_user_id')
    .eq('id', matchId)
    .limit(1);
  if (!matches || matches.length === 0) return json({ error: 'No such battle.' }, 404);
  const match = matches[0];
  if (match.status === 'settled') {
    return json({ settled: true, winner_user_id: match.winner_user_id, already: true });
  }
  if (match.status !== 'active') return json({ error: 'Battle has not started.' }, 409);

  const { data: rounds } = await svc
    .from('battle_rounds')
    .select('spec,starts_at,ends_at,status')
    .eq('match_id', matchId)
    .eq('round_no', 1)
    .limit(1);
  if (!rounds || rounds.length === 0) return json({ error: 'Round 1 never opened.' }, 409);
  const round = rounds[0];
  const spec = round.spec as unknown as StrengthSpec;

  const { data: eventRows } = await svc
    .from('battle_events')
    .select('user_id,payload,server_ts')
    .eq('match_id', matchId)
    .eq('round_no', 1)
    .eq('kind', 'volume')
    .order('server_ts');
  const byUser = new Map<string, VolumeEvent[]>();
  for (const p of participants) byUser.set(p.user_id, []);
  for (const r of (eventRows ?? []) as EventRow[]) {
    byUser.get(r.user_id)?.push(toVolume(r));
  }

  // Settle when the window is over, or the moment both have lifted the object.
  const windowOver = new Date() > new Date(round.ends_at);
  const bothDone = participants.every(
    (p) => totalEffectiveKg(byUser.get(p.user_id) ?? []) >= spec.targetEffectiveKg
  );
  if (!windowOver && !bothDone) {
    return json({ error: 'Round 1 is still open.', ends_at: round.ends_at }, 409);
  }

  // Pre-round e1RM bests per athlete: the overload band is measured against
  // what each athlete had ALREADY proven before the bell.
  const e1rmBefore = new Map<string, Record<string, number>>();
  for (const p of participants) {
    const { data: hist } = await svc
      .from('workout_log')
      .select('exercise,weight,reps')
      .eq('user_id', p.user_id)
      .gt('weight', 0)
      .gt('reps', 0)
      .lt('timestamp', round.starts_at)
      .limit(5000);
    const best: Record<string, number> = {};
    for (const h of hist ?? []) {
      const e1 = Number(h.weight) * (1 + Number(h.reps) / 30);
      const key = String(h.exercise);
      if (!(key in best) || e1 > best[key]) best[key] = e1;
    }
    e1rmBefore.set(p.user_id, best);
  }

  const results = participants.map((p) => {
    const opponent = participants.find((o) => o.user_id !== p.user_id)!;
    const stat = Number((p.snapshot as Record<string, unknown>).strengthScore ?? 0) || 0;
    const components = scoreStrengthRound(
      byUser.get(p.user_id) ?? [],
      byUser.get(opponent.user_id) ?? [],
      spec,
      stat,
      e1rmBefore.get(p.user_id) ?? {}
    );
    return { user_id: p.user_id, components };
  });

  for (const r of results) {
    const { error } = await svc.from('battle_round_scores').upsert(
      {
        match_id: matchId,
        round_no: 1,
        user_id: r.user_id,
        components: r.components,
        points: r.components.points,
      },
      { onConflict: 'match_id,round_no,user_id' }
    );
    if (error) return json({ error: `Could not store scores: ${error.message}` }, 500);
  }
  await svc.from('battle_rounds').update({ status: 'scored' }).eq('match_id', matchId).eq('round_no', 1);

  const [a, b] = results;
  const winner =
    a.components.points > b.components.points ? a.user_id
    : b.components.points > a.components.points ? b.user_id
    : null;

  for (const r of results) {
    const other = results.find((o) => o.user_id !== r.user_id)!;
    await svc
      .from('battle_participants')
      .update({
        total_score: r.components.points,
        xp_awarded: battleXp(r.components.points, other.components.points),
        rating_delta: 0, // friendly battles never move the ladder
      })
      .eq('match_id', matchId)
      .eq('user_id', r.user_id);
  }

  await svc
    .from('battle_matches')
    .update({ status: 'settled', winner_user_id: winner, settled_at: new Date().toISOString() })
    .eq('id', matchId);

  // The ledger grant — service key, recomputed amount, idempotent by the 002
  // unique index. A failed grant never fails the settle (the xp_drift oracle
  // will surface it), but it is never silent either: the error rides back.
  const grantErrors: string[] = [];
  for (const r of results) {
    const other = results.find((o) => o.user_id !== r.user_id)!;
    const { error } = await svc.from('xp_events').insert({
      user_id: r.user_id,
      kind: 'battle',
      amount: battleXp(r.components.points, other.components.points),
      source_table: 'battle_matches',
      source_id: matchId,
    });
    if (error && !/duplicate|unique/i.test(error.message)) grantErrors.push(error.message);
  }

  return json({
    settled: true,
    winner_user_id: winner,
    scores: results,
    grant_errors: grantErrors.length > 0 ? grantErrors : undefined,
  });
});
