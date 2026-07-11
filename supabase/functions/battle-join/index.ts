/**
 * battle-join: accept a friendly invite code as seat 2. Validates the code,
 * refuses self-battles and full matches, snapshots the joiner, and flips the
 * match to 'matched'.
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { callerUserId, cleanSnapshot, displayNameOf, participantsOf, serviceClient } from '../_shared/battle/service.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? '').trim().toUpperCase();
  if (code.length !== 6) return json({ error: 'Invite codes are six characters.' }, 400);

  const svc = serviceClient();

  const name = await displayNameOf(svc, userId);
  if (!name) {
    return json({ error: 'The Arena needs a public display name. Set one in Rank → public identity.' }, 403);
  }

  const { data: matches } = await svc
    .from('battle_matches')
    .select('id,status')
    .eq('invite_code', code)
    .limit(1);
  if (!matches || matches.length === 0) return json({ error: 'No battle with that code.' }, 404);
  const match = matches[0];
  if (match.status !== 'inviting') return json({ error: 'That battle already has a challenger.' }, 409);

  const existing = await participantsOf(svc, match.id);
  if (existing.some((p) => p.user_id === userId)) {
    return json({ error: 'You cannot battle yourself.' }, 409);
  }
  if (existing.length >= 2) return json({ error: 'That battle is full.' }, 409);

  const { error: pErr } = await svc.from('battle_participants').insert({
    match_id: match.id,
    user_id: userId,
    seat: 2,
    snapshot: cleanSnapshot(body.snapshot, name),
  });
  if (pErr) return json({ error: `Could not join: ${pErr.message}` }, 500);

  await svc.from('battle_matches').update({ status: 'matched' }).eq('id', match.id);
  return json({ match_id: match.id });
});
