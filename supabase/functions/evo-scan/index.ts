/**
 * evo-scan: the official guided Evo Scan (PROGRESSION_OVERHAUL P6,
 * spec §15C). Front/side/back photos + bodyweight + waist → Size and
 * Aesthetics sub-scores + regional scores, written to
 * physique_assessments WITH THE CALLER'S JWT (RLS applies).
 *
 * PRIVACY: solo photos are NEVER persisted (the house rule outranks the
 * spec's bucket design) — only sha256 hashes land, for the cache and the
 * 28-day eligibility. Large changes (spec: >~1 Evo point) are stored as
 * pending_confirmation and the client asks for a confirmation scan.
 *
 * Judge model: DEFAULT (gpt-5.1) — scan verdicts must stay consistent
 * across an athlete's history (the same rule as bodyfat/physique).
 */

import {
  CORS_HEADERS,
  callOpenAiJson,
  callerClient,
  cachedResult,
  json,
  rateLimited,
  sha256Hex,
  storeCache,
} from '../_shared/ai.ts';

const MODEL_VERSION = '1.0.0';
const ELIGIBLE_DAYS = 28;
const LARGE_CHANGE = 6; // sub-score points ≈ >1 Evo point after weights

const REGIONS = [
  'chest', 'frontDelts', 'sideDelts', 'rearDelts', 'backWidth', 'backThickness',
  'biceps', 'triceps', 'forearms', 'abdominals', 'glutes', 'quadriceps',
  'hamstrings', 'calves',
] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const sb = callerClient(req);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const images: string[] = (Array.isArray(body?.images) ? body.images : [])
    .filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('data:image/'))
    .slice(0, 3);
  if (images.length < 2) {
    return json({ error: 'A guided scan needs at least front and side photos.' }, 400);
  }
  const bodyweightKg = Number(body?.bodyweightKg ?? 0);
  // Waist is OPTIONAL (Tyson 2026-07-17): when absent the AI estimates it
  // from the photos + height + bodyweight, and the estimate is stored.
  const waistProvided = Number(body?.waistCm ?? 0) > 0;
  let waistCm = Number(body?.waistCm ?? 0);
  const heightCm = Number(body?.heightCm ?? 0);
  const sex = body?.sex === 'female' ? 'female' : 'male';
  const confirmation = body?.confirmation === true;
  if (!(bodyweightKg > 0)) {
    return json({ error: 'Current bodyweight is required.' }, 400);
  }

  // 28-day eligibility (confirmation scans within 7 days are the exception).
  const { data: lastScan } = await sb
    .from('physique_assessments')
    .select('assessment_date,status,size_score,aesthetics_score')
    .in('status', ['confirmed', 'pending_confirmation'])
    .order('assessment_date', { ascending: false })
    .limit(1);
  const last = lastScan?.[0] ?? null;
  // ORIGIN DISCOVERY EXCEPTION (Tyson 2026-07-18): an account with NO Origin
  // yet is being ASKED to scan at every sign-in — the 28-day cooldown must not
  // refuse the very scan that discovers their path.
  const { data: prof } = await sb.from('profile').select('origin_path').limit(1);
  const originUnset = (prof?.[0]?.origin_path ?? null) == null;
  if (last && !confirmation && !originUnset) {
    const ageDays = Math.floor(
      (Date.now() - Date.parse(String(last.assessment_date))) / 86_400_000
    );
    const pendingConfirm = last.status === 'pending_confirmation';
    if (!pendingConfirm && ageDays < ELIGIBLE_DAYS) {
      return json(
        { error: `Your next official Evo Scan unlocks in ${ELIGIBLE_DAYS - ageDays} days.` },
        429
      );
    }
  }

  const imageHash = await sha256Hex(images.join('|') + `|${bodyweightKg}|${waistCm}`);
  const fromCache = await cachedResult(sb, 'evo-scan', imageHash);
  if (!fromCache && (await rateLimited(sb))) {
    return json({ error: 'Scan limit reached. Try again in an hour.' }, 429);
  }

  let result = fromCache as Record<string, unknown> | null;
  if (!result) {
    const userText = `
Assess this ${sex} athlete's physique for a fitness tracking game from the attached photos (front, side${images.length > 2 ? ', back' : ''}).
Bodyweight ${bodyweightKg} kg${heightCm > 0 ? `, height ${heightCm} cm` : ''}${waistProvided ? `, waist ${waistCm} cm` : ' (no waist measurement given — ESTIMATE the waist circumference in cm from the photos, height and bodyweight, and include it as "waist_estimate_cm")'}. Do not identify the person. Judge conservatively and consistently.
Score 1-100 where 50 = a typical dedicated gym-goer after ~2 years, 90+ = national-competitor development.
Return ONLY valid JSON:
{
  "proportions_score": 0-100,
  "distribution_score": 0-100,
  "definition_score": 0-100,
  "symmetry_score": 0-100,
  "regional_scores": { ${REGIONS.map((r) => `"${r}": 0-100`).join(', ')} },
  "pose_consistent": true/false,
  "waist_estimate_cm": number,
  "notes": "one short sentence"
}`;
    const r = await callOpenAiJson(userText, images, [
      'proportions_score', 'distribution_score', 'definition_score', 'symmetry_score', 'regional_scores',
    ]);
    if (r.error || !r.data) return json({ error: r.error ?? 'The scan judge failed.' }, 502);
    result = r.data;
    await storeCache(sb, 'evo-scan', imageHash, result);
  }

  // No measurement given → use the AI's estimate (sanity-bounded).
  if (!waistProvided) {
    const est = Number((result as Record<string, unknown>).waist_estimate_cm ?? 0);
    waistCm = est >= 50 && est <= 200 ? est : Math.max(50, Math.round(bodyweightKg * 0.95));
  }

  const clamp = (v: unknown) => Math.max(1, Math.min(100, Number(v) || 1));
  const regional: Record<string, number> = {};
  const raw = (result.regional_scores ?? {}) as Record<string, unknown>;
  for (const k of REGIONS) regional[k] = clamp(raw[k]);
  const regionalValues = Object.values(regional);
  const regionalMean = regionalValues.reduce((s, v) => s + v, 0) / regionalValues.length;

  // Size/Aesthetics sub-score composition mirrors domain/progression —
  // the client review recomputes the FULL pillars with FFMI etc.; the
  // assessment stores the scan-derived components.
  const aesthetics =
    100 *
    Math.pow(clamp(result.proportions_score) / 100, 0.35) *
    Math.pow(clamp(result.distribution_score) / 100, 0.25) *
    Math.pow(clamp(result.definition_score) / 100, 0.25) *
    Math.pow(clamp(result.symmetry_score) / 100, 0.15);
  const size = regionalMean; // the scan's size contribution = regional development

  // Large-change rule: diverging hard from the last confirmed scan needs
  // a confirmation scan within 7 days.
  let status = 'confirmed';
  if (
    last &&
    !confirmation &&
    (Math.abs(size - Number(last.size_score ?? size)) > LARGE_CHANGE ||
      Math.abs(aesthetics - Number(last.aesthetics_score ?? aesthetics)) > LARGE_CHANGE)
  ) {
    status = 'pending_confirmation';
  }

  const poseConsistent = result.pose_consistent !== false;
  const confidence = Math.min(85, 40 + images.length * 12 + (poseConsistent ? 9 : -10));

  const { data: row, error: insErr } = await sb
    .from('physique_assessments')
    .insert({
      scan_type: confirmation ? 'confirmation' : 'monthly_guided',
      bodyweight_kg: bodyweightKg,
      waist_cm: waistCm,
      measurements: body?.measurements ?? {},
      image_hashes: [imageHash],
      size_score: size,
      aesthetics_score: aesthetics,
      proportions_score: clamp(result.proportions_score),
      distribution_score: clamp(result.distribution_score),
      definition_score: clamp(result.definition_score),
      symmetry_score: clamp(result.symmetry_score),
      regional_scores: regional,
      confidence,
      status,
      model_version: MODEL_VERSION,
      assessment_date: new Date().toISOString().slice(0, 10),
    })
    .select('id,status')
    .limit(1);
  if (insErr) return json({ error: `Could not store the assessment: ${insErr.message}` }, 500);

  return json({
    result: {
      id: row?.[0]?.id,
      status,
      sizeScore: size,
      aestheticsScore: aesthetics,
      regionalScores: regional,
      confidence,
      notes: String(result.notes ?? ''),
    },
    cached: Boolean(fromCache),
  });
});
