/**
 * battle-settle: the ONLY place battles advance and get decided. Called by
 * either participant, it:
 *   1. scores the currently-open round from trigger-validated battle_events
 *      (rounds 1–2) or battle_media verdicts (round 3) — the client only
 *      previews, the engine copy here is authoritative;
 *   2. rolls and opens the next round (cardio 10 min, physique 5 min); or
 *   3. after round 3, totals all rounds, crowns the winner, and grants
 *      ledger XP with the service key.
 * Idempotent: a settled match returns its verdict; scored rounds recompute
 * to the same numbers; the 002 unique index absorbs re-grants.
 */

import { CORS_HEADERS, json, sha256Hex } from '../_shared/ai.ts';
import {
  BATTLE_POSES,
  CARDIO_CHALLENGES,
  battleXp,
  scoreCardioRound,
  scorePhysiqueRound,
  scoreStrengthRound,
  totalEffectiveKg,
  totalEnergyUnits,
  type CardioEvent,
  type PhysiqueVerdict,
  type StrengthSpec,
  type VolumeEvent,
} from '../_shared/battle/engine.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

const CARDIO_MINUTES = 10;
const PHYSIQUE_MINUTES = 5;
export const PHYSIQUE_MAX_ATTEMPTS = 2;

interface EventRow {
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  server_ts: string;
}

const toVolume = (r: EventRow): VolumeEvent => ({
  exercise: String(r.payload.exercise ?? ''),
  weightKg: Number(r.payload.weight ?? 0) || 0,
  reps: Number(r.payload.reps ?? 0) || 0,
  serverTs: r.server_ts,
});

const toCardio = (r: EventRow): CardioEvent => ({
  type: String(r.payload.type ?? ''),
  minutes: Number(r.payload.minutes ?? 0) || 0,
  distanceKm: Number(r.payload.distance_km ?? 0) || 0,
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
    .select('id,status,current_round,winner_user_id')
    .eq('id', matchId)
    .limit(1);
  if (!matches || matches.length === 0) return json({ error: 'No such battle.' }, 404);
  const match = matches[0];
  if (match.status === 'settled') {
    return json({ settled: true, winner_user_id: match.winner_user_id, already: true });
  }
  if (match.status !== 'active') return json({ error: 'Battle has not started.' }, 409);

  const roundNo = Number(match.current_round);
  const { data: rounds } = await svc
    .from('battle_rounds')
    .select('round_no,kind,spec,starts_at,ends_at,status')
    .eq('match_id', matchId)
    .eq('round_no', roundNo)
    .limit(1);
  if (!rounds || rounds.length === 0) return json({ error: `Round ${roundNo} never opened.` }, 409);
  const round = rounds[0];
  const windowOver = new Date() > new Date(round.ends_at);

  const { data: eventRows } = await svc
    .from('battle_events')
    .select('user_id,kind,payload,server_ts')
    .eq('match_id', matchId)
    .eq('round_no', roundNo)
    .in('kind', ['volume', 'cardio'])
    .order('server_ts');
  const byUser = new Map<string, EventRow[]>();
  for (const p of participants) byUser.set(p.user_id, []);
  for (const r of (eventRows ?? []) as EventRow[]) byUser.get(r.user_id)?.push(r);

  // ---- score the open round ------------------------------------------------
  let results: { user_id: string; points: number; components: Record<string, unknown> }[];

  if (round.kind === 'strength') {
    const spec = round.spec as unknown as StrengthSpec;
    const vols = new Map(participants.map((p) => [p.user_id, (byUser.get(p.user_id) ?? []).map(toVolume)]));
    const bothDone = participants.every(
      (p) => totalEffectiveKg(vols.get(p.user_id) ?? []) >= spec.targetEffectiveKg
    );
    if (!windowOver && !bothDone) {
      return json({ error: 'Round 1 is still open.', ends_at: round.ends_at }, 409);
    }
    // Overload band: each athlete's own bests BEFORE the bell.
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
    results = participants.map((p) => {
      const opp = participants.find((o) => o.user_id !== p.user_id)!;
      const stat = Number((p.snapshot as Record<string, unknown>).strengthScore ?? 0) || 0;
      const c = scoreStrengthRound(vols.get(p.user_id)!, vols.get(opp.user_id)!, spec, stat, e1rmBefore.get(p.user_id) ?? {});
      return { user_id: p.user_id, points: c.points, components: c as unknown as Record<string, unknown> };
    });
  } else if (round.kind === 'cardio') {
    const spec = round.spec as unknown as { targetUnits: number; challengeKey: string; engineVersion: number };
    const cards = new Map(
      participants.map((p) => [
        p.user_id,
        (byUser.get(p.user_id) ?? []).filter((e) => e.kind === 'cardio').map(toCardio),
      ])
    );
    const bothDone = participants.every(
      (p) => totalEnergyUnits(cards.get(p.user_id) ?? []) >= spec.targetUnits
    );
    if (!windowOver && !bothDone) {
      return json({ error: 'Round 2 is still open.', ends_at: round.ends_at }, 409);
    }
    results = participants.map((p) => {
      const opp = participants.find((o) => o.user_id !== p.user_id)!;
      const stat = Number((p.snapshot as Record<string, unknown>).conditioningScore ?? 0) || 0;
      const c = scoreCardioRound(cards.get(p.user_id)!, cards.get(opp.user_id)!, spec, stat);
      return { user_id: p.user_id, points: c.points, components: c as unknown as Record<string, unknown> };
    });
  } else {
    // physique: score from the LAST judged battle_media verdict per athlete.
    const { data: media } = await svc
      .from('battle_media')
      .select('user_id,verdict,confidence,compliant,created_at')
      .eq('match_id', matchId)
      .eq('round_no', roundNo)
      .order('created_at');
    const lastByUser = new Map<string, { verdict: Record<string, unknown> | null; confidence: string; compliant: boolean }>();
    const attempts = new Map<string, number>();
    for (const m of media ?? []) {
      lastByUser.set(m.user_id, m as never);
      attempts.set(m.user_id, (attempts.get(m.user_id) ?? 0) + 1);
    }
    const isFinal = (uid: string) => {
      const last = lastByUser.get(uid);
      if (!last) return false;
      return String(last.confidence).toLowerCase() !== 'low' || (attempts.get(uid) ?? 0) >= PHYSIQUE_MAX_ATTEMPTS;
    };
    const bothFinal = participants.every((p) => isFinal(p.user_id));
    if (!windowOver && !bothFinal) {
      return json({ error: 'Round 3 is still open.', ends_at: round.ends_at }, 409);
    }
    results = participants.map((p) => {
      const last = lastByUser.get(p.user_id);
      const verdict: PhysiqueVerdict | null = last
        ? {
            muscular_development: Number((last.verdict ?? {}).muscular_development ?? 0) || 0,
            conditioning: Number((last.verdict ?? {}).conditioning ?? 0) || 0,
            symmetry: Number((last.verdict ?? {}).symmetry ?? 0) || 0,
            proportion: Number((last.verdict ?? {}).proportion ?? 0) || 0,
            presentation: Number((last.verdict ?? {}).presentation ?? 0) || 0,
            compliant: Boolean(last.compliant),
            confidence: String(last.confidence ?? 'low'),
          }
        : null;
      // Aesthetic isn't in the P1 snapshot; strength/conditioning blend
      // stands in until snapshots carry it (clamped by the same 15% gate).
      const snap = p.snapshot as Record<string, unknown>;
      const stat =
        ((Number(snap.strengthScore ?? 0) || 0) + (Number(snap.conditioningScore ?? 0) || 0)) / 2;
      const c = scorePhysiqueRound(verdict, stat);
      return { user_id: p.user_id, points: c.points, components: c as unknown as Record<string, unknown> };
    });
  }

  for (const r of results) {
    const { error } = await svc.from('battle_round_scores').upsert(
      { match_id: matchId, round_no: roundNo, user_id: r.user_id, components: r.components, points: r.points },
      { onConflict: 'match_id,round_no,user_id' }
    );
    if (error) return json({ error: `Could not store scores: ${error.message}` }, 500);
  }
  await svc.from('battle_rounds').update({ status: 'scored' }).eq('match_id', matchId).eq('round_no', roundNo);

  // ---- open the next round, or finalize -----------------------------------
  if (roundNo < 3) {
    const hash = await sha256Hex(matchId);
    const nextNo = roundNo + 1;
    const startsAt = new Date();
    let spec: Record<string, unknown>;
    let kind: string;
    let minutes: number;
    if (nextNo === 2) {
      const roll = parseInt(hash.slice(8, 16), 16) % CARDIO_CHALLENGES.length;
      const challenge = CARDIO_CHALLENGES[roll];
      kind = 'cardio';
      minutes = CARDIO_MINUTES;
      spec = { challengeKey: challenge.key, targetUnits: challenge.blitzTargetUnits, engineVersion: 2, roll_seed: hash.slice(8, 16) };
    } else {
      const roll = parseInt(hash.slice(16, 24), 16) % BATTLE_POSES.length;
      kind = 'physique';
      minutes = PHYSIQUE_MINUTES;
      spec = { poseKey: BATTLE_POSES[roll].key, engineVersion: 2, roll_seed: hash.slice(16, 24) };
    }
    const { error: rErr } = await svc.from('battle_rounds').insert({
      match_id: matchId,
      round_no: nextNo,
      kind,
      spec,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
      status: 'open',
    });
    if (rErr && !/duplicate|unique/i.test(rErr.message)) {
      return json({ error: `Could not open round ${nextNo}: ${rErr.message}` }, 500);
    }
    await svc.from('battle_matches').update({ current_round: nextNo }).eq('id', matchId);
    return json({ round_scored: roundNo, next_round: nextNo });
  }

  const { data: allScores } = await svc
    .from('battle_round_scores')
    .select('user_id,points')
    .eq('match_id', matchId);
  const totals = new Map<string, number>();
  for (const p of participants) totals.set(p.user_id, 0);
  for (const s of allScores ?? []) totals.set(s.user_id, (totals.get(s.user_id) ?? 0) + Number(s.points));

  const [pa, pb] = participants;
  const ta = totals.get(pa.user_id) ?? 0;
  const tb = totals.get(pb.user_id) ?? 0;
  const winner = ta > tb ? pa.user_id : tb > ta ? pb.user_id : null;

  for (const p of participants) {
    const mine = totals.get(p.user_id) ?? 0;
    const theirs = totals.get(participants.find((o) => o.user_id !== p.user_id)!.user_id) ?? 0;
    await svc
      .from('battle_participants')
      .update({ total_score: mine, xp_awarded: battleXp(mine, theirs), rating_delta: 0 })
      .eq('match_id', matchId)
      .eq('user_id', p.user_id);
  }
  await svc
    .from('battle_matches')
    .update({ status: 'settled', winner_user_id: winner, settled_at: new Date().toISOString() })
    .eq('id', matchId);

  const grantErrors: string[] = [];
  for (const p of participants) {
    const mine = totals.get(p.user_id) ?? 0;
    const theirs = totals.get(participants.find((o) => o.user_id !== p.user_id)!.user_id) ?? 0;
    const { error } = await svc.from('xp_events').insert({
      user_id: p.user_id,
      kind: 'battle',
      amount: battleXp(mine, theirs),
      source_table: 'battle_matches',
      source_id: matchId,
    });
    if (error && !/duplicate|unique/i.test(error.message)) grantErrors.push(error.message);
  }

  return json({
    settled: true,
    winner_user_id: winner,
    totals: { [pa.user_id]: ta, [pb.user_id]: tb },
    grant_errors: grantErrors.length > 0 ? grantErrors : undefined,
  });
});
