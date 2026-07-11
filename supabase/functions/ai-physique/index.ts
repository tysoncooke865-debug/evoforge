/**
 * ai-physique: photos + stats -> the four /15 scores, written to
 * physique_ratings WITH THE CALLER'S JWT, result returned. Photos are never
 * stored; sha256(images) keys the cache and the hourly rate limit.
 * Prompt and schema mirror services/ai_physique.py verbatim.
 */

import {
  CORS_HEADERS,
  callOpenAiJson,
  callerClient,
  cachedResult,
  json,
  nowIsoSeconds,
  rateLimited,
  sha256Hex,
  storeCache,
} from '../_shared/ai.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = callerClient(req);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => null);
  const images: string[] = Array.isArray(body?.images) ? body.images.filter((i: unknown) => typeof i === 'string') : [];
  const stats = body?.stats ?? {};
  if (images.length === 0) return json({ error: 'Upload at least one physique photo.' }, 400);
  if (images.length > 3) return json({ error: 'At most three photos.' }, 400);

  const imageHash = await sha256Hex(images.join('|'));

  const cached = await cachedResult(sb, 'physique', imageHash);
  if (cached) return json({ result: cached, cached: true });

  if (await rateLimited(sb)) {
    return json({ error: 'Hourly AI scan limit reached. Try again later.' }, 429);
  }

  const userText = `
Rate this male physique for an aesthetic fitness app. Do not identify the person.
Return ONLY valid JSON.

Stats:
${JSON.stringify(stats, null, 2)}

JSON schema:
{
  "physique_score": number,
  "leanness_score": number,
  "symmetry_score": number,
  "muscularity_score": number,
  "confidence": "low" | "medium" | "high",
  "weak_points": ["short point", "short point", "short point"],
  "improvements": ["short actionable improvement", "short actionable improvement", "short actionable improvement"],
  "summary": "short honest summary",
  "training_priority": ["Chest", "Side delts", "Back width", "Arms", "Legs", "Abs"]
}

Scores are out of 15. Be realistic and useful.
`;

  const { data, error } = await callOpenAiJson(userText, images, [
    'physique_score',
    'leanness_score',
    'symmetry_score',
    'muscularity_score',
    'confidence',
    'weak_points',
    'improvements',
    'summary',
  ]);
  if (error || !data) return json({ error: error ?? 'AI physique rating failed.' }, 502);

  const timestamp = nowIsoSeconds();
  // The function writes the row itself, as the caller -- the client never
  // gets to invent scores (MIGRATION_PLAN "AI via Edge Functions").
  const { error: writeError } = await sb.from('physique_ratings').insert({
    date: timestamp.slice(0, 10),
    physique_score: data.physique_score,
    leanness_score: data.leanness_score,
    symmetry_score: data.symmetry_score,
    muscularity_score: data.muscularity_score,
    confidence: String(data.confidence ?? ''),
    weak_points: data.weak_points ?? [],
    improvements: data.improvements ?? [],
    summary: String(data.summary ?? ''),
    timestamp,
  });
  if (writeError) return json({ error: `Rating computed but not saved: ${writeError.message}` }, 500);

  await storeCache(sb, 'physique', imageHash, data);
  return json({ result: data, cached: false });
});
