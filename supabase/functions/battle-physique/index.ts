/**
 * battle-physique: Round 3's judge. A camera-captured photo arrives as a
 * data URI; this function
 *   1. verifies the caller is a participant and round 3 is open,
 *   2. rejects photo reuse (sha256 unique per athlete, forever) and enforces
 *      the two-attempt cap,
 *   3. stores the image in the PRIVATE battle-media bucket (D2: participants
 *      of this match may view it; solo Oracle scans remain never-persisted),
 *   4. has the AI judge the rolled pose: compliance + five /15 axes,
 *   5. writes battle_media (service) + a photo_hash event for realtime.
 * Low confidence → retry_requested; the settle function applies the floor.
 * The verdict returns to the caller but SCORING happens only at settle.
 */

import { CORS_HEADERS, callOpenAiJson, json, sha256Hex } from '../_shared/ai.ts';
import { poseByKey } from '../_shared/battle/engine.ts';
import { callerUserId, participantsOf, serviceClient } from '../_shared/battle/service.ts';

const MAX_ATTEMPTS = 2;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const matchId = String(body.match_id ?? '');
  const image = String(body.image ?? '');
  if (!matchId || !image) return json({ error: 'match_id and image required.' }, 400);

  const svc = serviceClient();
  const participants = await participantsOf(svc, matchId);
  if (!participants.some((p) => p.user_id === userId)) {
    return json({ error: 'Not your battle.' }, 403);
  }

  const { data: rounds } = await svc
    .from('battle_rounds')
    .select('round_no,spec,starts_at,ends_at,status')
    .eq('match_id', matchId)
    .eq('kind', 'physique')
    .limit(1);
  if (!rounds || rounds.length === 0) return json({ error: 'The physique round has not opened.' }, 409);
  const round = rounds[0];
  const now = new Date();
  if (round.status !== 'open' || now < new Date(round.starts_at) || now > new Date(round.ends_at)) {
    return json({ error: 'The physique round is not accepting photos.' }, 409);
  }

  const { count: attempts } = await svc
    .from('battle_media')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .eq('round_no', round.round_no);
  if ((attempts ?? 0) >= MAX_ATTEMPTS) {
    return json({ error: 'Both photo attempts are used. Your last verdict stands.' }, 409);
  }

  const decoded = dataUriToBytes(image);
  if (!decoded) return json({ error: 'The photo must arrive as an image data URI.' }, 400);

  const hash = await sha256Hex(image);
  const { data: reused } = await svc
    .from('battle_media')
    .select('id')
    .eq('user_id', userId)
    .eq('sha256', hash)
    .limit(1);
  if (reused && reused.length > 0) {
    return json({ error: 'That exact photo has been entered before. Capture a fresh one.' }, 409);
  }

  const pose = poseByKey(String((round.spec as Record<string, unknown>).poseKey ?? ''));

  // Judge BEFORE storing: a photo that fails to parse never lands anywhere.
  const userText = `
You are judging ROUND 3 of a fitness battle. The required pose is: "${pose.name}".
Judge the physique in the photo. Do not identify the person. Return ONLY valid JSON.

JSON schema:
{
  "pose_compliant": boolean,        // is this recognisably the required pose, a fresh camera shot of a real person?
  "muscular_development": number,   // 0-15
  "conditioning": number,           // 0-15 (leanness / hardness)
  "symmetry": number,               // 0-15
  "proportion": number,             // 0-15
  "presentation": number,           // 0-15 (framing, lighting, pose quality)
  "confidence": "low" | "medium" | "high",
  "notes": "one short honest sentence"
}

If the image is not a person, is heavily obscured, or you cannot judge honestly, set confidence "low".
`;
  const { data: verdict, error: aiError } = await callOpenAiJson(userText, [image], [
    'pose_compliant',
    'muscular_development',
    'conditioning',
    'symmetry',
    'proportion',
    'presentation',
    'confidence',
  ]);
  if (aiError || !verdict) return json({ error: aiError ?? 'The judge returned nothing.' }, 502);

  const attemptNo = (attempts ?? 0) + 1;
  const ext = decoded.mime === 'image/png' ? 'png' : 'jpg';
  const storagePath = `${matchId}/${userId}/${round.round_no}-${attemptNo}.${ext}`;
  const { error: upErr } = await svc.storage
    .from('battle-media')
    .upload(storagePath, decoded.bytes.buffer as ArrayBuffer, { contentType: decoded.mime, upsert: true });
  if (upErr) return json({ error: `Could not store the photo: ${upErr.message}` }, 500);

  const confidence = String(verdict.confidence ?? 'low').toLowerCase();
  const compliant = Boolean(verdict.pose_compliant);
  const { error: mErr } = await svc.from('battle_media').insert({
    match_id: matchId,
    user_id: userId,
    round_no: round.round_no,
    sha256: hash,
    pose: pose.key,
    storage_path: storagePath,
    verdict,
    confidence,
    compliant,
  });
  if (mErr) return json({ error: `Verdict computed but not saved: ${mErr.message}` }, 500);

  // Realtime tick for the opponent (service role passes the events guard).
  await svc.from('battle_events').insert({
    match_id: matchId,
    user_id: userId,
    round_no: round.round_no,
    kind: 'photo_hash',
    payload: { sha256: hash, attempt: attemptNo, confidence, compliant },
  });

  const retryRequested = confidence === 'low' && attemptNo < MAX_ATTEMPTS;
  return json({
    verdict,
    compliant,
    confidence,
    attempt: attemptNo,
    retry_requested: retryRequested,
  });
});
