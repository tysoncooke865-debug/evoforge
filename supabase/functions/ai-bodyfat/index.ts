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
  const save = body?.save !== false; // estimate passes preview without saving

  // IMPROVEMENT_PLAN #6: user-confirmed conditions. A corrected re-run gets
  // its OWN cache key -- the same image under different attested conditions
  // is a different question, and the old key would return the old verdict.
  const confirmed = body?.confirmed_conditions as { lighting?: string; pump?: string } | undefined;
  const condSuffix = confirmed ? `|cond:${String(confirmed.lighting)}:${String(confirmed.pump)}` : '';
  const imageHash = await sha256Hex(images.join('|') + condSuffix);

  // Cache-or-model, then save if asked: the confirm-unchanged pass is a
  // cache hit by design (same key, no second OpenAI spend) but must STILL
  // write the row -- an early return here would skip the save entirely.
  let data = await cachedResult(sb, 'bodyfat', imageHash);
  const fromCache = data !== null;

  if (!fromCache && (await rateLimited(sb))) {
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

${confirmed ? `
THE ATHLETE HAS CONFIRMED the photo conditions: lighting is "${confirmed.lighting}", pump is "${confirmed.pump}". Trust these over your own impression -- discount a strong pump, and do not over-credit unflattering light.
` : ''}
Do not use waist or neck unless provided. Be conservative with flattering lighting or pump.
Also estimate the photo conditions you observe.

JSON schema:
{
  "bf_low": number,
  "bf_high": number,
  "bf_mid": number,
  "confidence": "low" | "medium" | "high",
  "notes": "short practical explanation",
  "fat_storage": "short note",
  "ten_percent_notes": "short note",
  "conditions": { "lighting": "flattering" | "neutral" | "unflattering", "pump": "none" | "mild" | "moderate" | "strong" }
}
`;

  if (!data) {
    const r = await callOpenAiJson(userText, images, ['bf_low', 'bf_high', 'bf_mid', 'confidence', 'notes']);
    if (r.error || !r.data) return json({ error: r.error ?? 'AI estimate failed.' }, 502);
    data = r.data;
    // Model omitted conditions -> honest neutral fallback, marked as such.
    if (!data.conditions) data.conditions = { lighting: 'neutral', pump: 'none', estimated: false };
  }

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
      // Confirmed conditions ride in notes (free text) -- no schema change.
      notes:
        String(data.notes ?? '') +
        (confirmed ? ` · conditions confirmed: lighting ${confirmed.lighting}, pump ${confirmed.pump}` : ''),
      timestamp,
    });
    if (writeError) return json({ error: `Estimate computed but not saved: ${writeError.message}` }, 500);
  }

  if (!fromCache) await storeCache(sb, 'bodyfat', imageHash, data);
  return json({ result: data, cached: fromCache, saved: save });
});
