/**
 * ai-bodyfat: photos + context -> bf_low/mid/high, written to bodyfat_log
 * (method 'AI Photo') WITH THE CALLER'S JWT. Photos never stored. Prompt and
 * schema mirror services/ai_bodyfat.py verbatim.
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
  if (images.length === 0) return json({ error: 'Upload at least one physique photo.' }, 400);
  if (images.length > 2) return json({ error: 'At most two photos.' }, 400);

  const heightCm = Number(body?.height_cm) || 0;
  const weightKg = Number(body?.weight_kg) || 0;
  const waistCm = Number(body?.waist_cm) || 0;
  const neckCm = Number(body?.neck_cm) || 0;
  const lighting = String(body?.lighting ?? 'Unknown');
  const pumpStatus = String(body?.pump_status ?? 'Unknown');
  const timeOfDay = String(body?.time_of_day ?? 'Unknown');
  const save = body?.save !== false; // onboarding previews without saving

  const imageHash = await sha256Hex(images.join('|'));

  const cached = await cachedResult(sb, 'bodyfat', imageHash);
  if (cached) return json({ result: cached, cached: true });

  if (await rateLimited(sb)) {
    return json({ error: 'Hourly AI scan limit reached. Try again later.' }, 429);
  }

  const userText = `
Estimate male body fat percentage from physique photos for a fitness tracking app.
Return ONLY valid JSON.

Stats:
- Height: ${heightCm} cm
- Bodyweight: ${weightKg} kg
- Waist: ${waistCm > 0 ? waistCm : 'Not provided'}
- Neck: ${neckCm > 0 ? neckCm : 'Not provided'}
- Lighting: ${lighting}
- Pump status: ${pumpStatus}
- Time of day: ${timeOfDay}

Do not use waist or neck unless provided. Be conservative with flattering lighting or pump.

JSON schema:
{
  "bf_low": number,
  "bf_high": number,
  "bf_mid": number,
  "confidence": "low" | "medium" | "high",
  "notes": "short practical explanation",
  "fat_storage": "short note",
  "ten_percent_notes": "short note"
}
`;

  const { data, error } = await callOpenAiJson(userText, images, [
    'bf_low',
    'bf_high',
    'bf_mid',
    'confidence',
    'notes',
  ]);
  if (error || !data) return json({ error: error ?? 'AI estimate failed.' }, 502);

  if (save) {
    const timestamp = nowIsoSeconds();
    const round2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
    const { error: writeError } = await sb.from('bodyfat_log').insert({
      date: timestamp.slice(0, 10),
      method: 'AI Photo',
      bodyweight: weightKg,
      height_cm: heightCm,
      waist_cm: waistCm,
      neck_cm: neckCm,
      bf_low: round2(data.bf_low),
      bf_high: round2(data.bf_high),
      bf_mid: round2(data.bf_mid),
      confidence: String(data.confidence ?? ''),
      notes: String(data.notes ?? ''),
      timestamp,
    });
    if (writeError) return json({ error: `Estimate computed but not saved: ${writeError.message}` }, 500);
  }

  await storeCache(sb, 'bodyfat', imageHash, data);
  return json({ result: data, cached: false, saved: save });
});
