/**
 * damage-assessment: the pre/post pump-photo mini-game between friends
 * (migration 038, MULTIPLAYER_ROADMAP Phase 3).
 *
 * POST { assessment_id, kind: 'pre' | 'post', image: dataURI }
 *   1. caller must be a participant of an OPEN assessment; 'post' needs 'pre';
 *   2. photo-reuse rejected forever (sha256 unique per athlete — the
 *      battle-physique rule);
 *   3. stored in the PRIVATE battle-media bucket under da/<id>/… (BATTLE_ARENA
 *      D2: the one sanctioned persistence exception);
 *   4. when all FOUR photos are in, the AI compares each athlete's PRE→POST
 *      change (pump/vascularity/definition, 0–100) in a single 4-image call,
 *      the winner is finalized server-side (verdict + idempotent XP + rivalry
 *      via the service-role-only RPC), and ALL FOUR photos are DELETED in this
 *      same invocation — only scores + a one-line blurb survive.
 */

import { CORS_HEADERS, callOpenAiJson, json, sha256Hex } from '../_shared/ai.ts';
import { callerUserId, serviceClient } from '../_shared/battle/service.ts';

function dataUriToBytes(uri: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(uri);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] };
  } catch {
    return null;
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const assessmentId = String(body.assessment_id ?? '');
  const kind = String(body.kind ?? '');
  const image = String(body.image ?? '');
  if (!assessmentId || !['pre', 'post'].includes(kind) || !image) {
    return json({ error: 'assessment_id, kind (pre|post) and image required.' }, 400);
  }

  const svc = serviceClient();
  const { data: das } = await svc.from('damage_assessments').select('*').eq('id', assessmentId).limit(1);
  const da = das?.[0];
  if (!da || (da.challenger_id !== userId && da.opponent_id !== userId)) {
    return json({ error: 'Not your assessment.' }, 403);
  }
  if (da.status !== 'open') return json({ error: 'This assessment is closed.' }, 409);

  const { data: mine } = await svc
    .from('da_photos')
    .select('kind')
    .eq('assessment_id', assessmentId)
    .eq('user_id', userId);
  const haveKinds = new Set((mine ?? []).map((r: { kind: string }) => r.kind));
  if (kind === 'pre' && haveKinds.has('pre')) return json({ error: 'Your PRE photo is already in.' }, 409);
  if (kind === 'post' && !haveKinds.has('pre')) return json({ error: 'PRE photo first — capture it before you train.' }, 409);
  if (kind === 'post' && haveKinds.has('post')) return json({ error: 'Your POST photo is already in.' }, 409);

  const decoded = dataUriToBytes(image);
  if (!decoded) return json({ error: 'The photo must arrive as an image data URI.' }, 400);

  const hash = await sha256Hex(image);
  const { data: reused } = await svc.from('da_photos').select('id').eq('user_id', userId).eq('sha256', hash).limit(1);
  if (reused && reused.length > 0) return json({ error: 'That exact photo has been entered before. Capture a fresh one.' }, 409);

  const ext = decoded.mime === 'image/png' ? 'png' : 'jpg';
  const storagePath = `da/${assessmentId}/${userId}/${kind}.${ext}`;
  const { error: upErr } = await svc.storage
    .from('battle-media')
    .upload(storagePath, decoded.bytes.buffer as ArrayBuffer, { contentType: decoded.mime, upsert: true });
  if (upErr) return json({ error: `Could not store the photo: ${upErr.message}` }, 500);

  const { error: insErr } = await svc.from('da_photos').insert({
    assessment_id: assessmentId,
    user_id: userId,
    kind,
    sha256: hash,
    storage_path: storagePath,
  });
  if (insErr) return json({ error: `Photo stored but not recorded: ${insErr.message}` }, 500);

  // All four in? Judge, finalize, and DELETE the photos — all in this call.
  const { data: all } = await svc
    .from('da_photos')
    .select('user_id,kind,storage_path')
    .eq('assessment_id', assessmentId);
  const rows = (all ?? []) as { user_id: string; kind: string; storage_path: string }[];
  const byKey = new Map(rows.map((r) => [`${r.user_id}:${r.kind}`, r.storage_path]));
  const challengerId = da.challenger_id as string;
  const opponentId = da.opponent_id as string;
  const need = [
    `${challengerId}:pre`, `${challengerId}:post`,
    `${opponentId}:pre`, `${opponentId}:post`,
  ];
  if (!need.every((k) => byKey.has(k))) {
    return json({ ok: true, judged: false, awaiting: need.filter((k) => !byKey.has(k)).length });
  }

  // Download the four in the judged order (this submit's image is already in
  // storage too, so one uniform path).
  const uris: string[] = [];
  for (const k of need) {
    const { data: blob, error: dlErr } = await svc.storage.from('battle-media').download(byKey.get(k)!);
    if (dlErr || !blob) return json({ error: 'Could not load a stored photo for judging.' }, 500);
    uris.push(await blobToDataUri(blob));
  }

  const userText = `
You are judging a DAMAGE ASSESSMENT between two athletes. You get FOUR photos in
this exact order: Athlete A PRE-workout, Athlete A POST-workout, Athlete B
PRE-workout, Athlete B POST-workout. Judge how much each athlete's physique
visibly CHANGED from their own PRE to their own POST (pump, vascularity, muscle
fullness, definition). Compare each athlete only against themselves. Do not
identify anyone. Return ONLY valid JSON.

JSON schema:
{
  "a_delta": number,     // 0-100, Athlete A's visible pre→post change
  "b_delta": number,     // 0-100, Athlete B's visible pre→post change
  "a_blurb": "one short sentence on Athlete A's change",
  "b_blurb": "one short sentence on Athlete B's change",
  "judgeable": boolean   // false if any photo is not a real person or unusable
}`;
  const { data: verdict, error: aiError } = await callOpenAiJson(userText, uris, [
    'a_delta', 'b_delta', 'a_blurb', 'b_blurb', 'judgeable',
  ]);
  if (aiError || !verdict) return json({ error: aiError ?? 'The judge returned nothing.' }, 502);

  const judgeable = Boolean(verdict.judgeable);
  const aDelta = Math.max(0, Math.min(100, Number(verdict.a_delta) || 0));
  const bDelta = Math.max(0, Math.min(100, Number(verdict.b_delta) || 0));
  // A tie inside 3 points is a draw — the judge cannot honestly split finer.
  const winner = !judgeable || Math.abs(aDelta - bDelta) <= 3 ? null : aDelta > bDelta ? challengerId : opponentId;

  const finalVerdict = {
    judgeable,
    challenger: { delta: aDelta, blurb: String(verdict.a_blurb ?? '') },
    opponent: { delta: bDelta, blurb: String(verdict.b_blurb ?? '') },
  };
  const { data: fin, error: finErr } = await svc.rpc('finalize_damage_assessment', {
    p_id: assessmentId,
    p_winner: winner,
    p_verdict: finalVerdict,
  });
  if (finErr) return json({ error: `Judged but not finalized: ${finErr.message}` }, 500);

  // D2: the photos are DELETED the moment the verdict exists.
  await svc.storage.from('battle-media').remove(need.map((k) => byKey.get(k)!));

  return json({ ok: true, judged: true, winner, verdict: finalVerdict, finalize: fin });
});
