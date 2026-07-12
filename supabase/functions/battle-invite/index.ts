/**
 * battle-invite: create a friendly BLITZ match and mint its invite code.
 * Caller must have the public_profile display name (D4). The match and the
 * seat-1 participant row are written with the SERVICE client — clients have
 * no write path to battle_matches at all.
 */

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { callerUserId, cleanSnapshot, displayNameOf, serviceClient } from '../_shared/battle/service.ts';

// No 0/O/1/I/L: codes get read aloud across a gym.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function mintCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  // Formats a friendly invite may mint. 'full' waits on its implementation;
  // 'heads_or_tails' joins this list when battle-pick ships (MG2).
  const format = String(body.format ?? 'blitz');
  if (!['blitz', 'volume_duel'].includes(format)) {
    return json({ error: `Unknown format: ${format}` }, 400);
  }
  const svc = serviceClient();

  const name = await displayNameOf(svc, userId);
  if (!name) {
    return json({ error: 'The Arena needs a public display name. Set one in Rank → public identity.' }, 403);
  }

  const { data: season } = await svc
    .from('battle_seasons')
    .select('id')
    .eq('is_active', true)
    .limit(1);
  const seasonId = season && season.length > 0 ? season[0].id : null;

  // Mint until the unique index is happy (collisions are ~nonexistent).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    const { data: match, error } = await svc
      .from('battle_matches')
      .insert({ season_id: seasonId, mode: 'friendly', format, status: 'inviting', invite_code: code })
      .select('id,invite_code')
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) continue;
      return json({ error: `Could not create the match: ${error.message}` }, 500);
    }

    const { error: pErr } = await svc.from('battle_participants').insert({
      match_id: match.id,
      user_id: userId,
      seat: 1,
      snapshot: cleanSnapshot(body.snapshot, name),
    });
    if (pErr) {
      await svc.from('battle_matches').delete().eq('id', match.id);
      return json({ error: `Could not join your own match: ${pErr.message}` }, 500);
    }

    return json({ match_id: match.id, invite_code: match.invite_code });
  }
  return json({ error: 'Could not mint an invite code. Try again.' }, 500);
});
