/**
 * ai-plan (IMPROVEMENT_PLAN #10): the AI custom routine, ported from
 * services/ai_physique.py::run_ai_custom_plan_from_physique. Returns the
 * validated plan WITHOUT saving — the client previews and the athlete's
 * accept writes the rows under their own RLS. Never trust the model's
 * shape: day names must be EXACTLY the six PPPPLA days so scheduling and
 * logging map 1:1, sets clamp to 1–8, strings are bounded.
 */

import { CORS_HEADERS, callOpenAiJson, callerClient, cachedResult, json, rateLimited, sha256Hex, storeCache } from '../_shared/ai.ts';

// The six live training days — client/src/domain/catalogs.ts ROUTINE_ORDER
// minus Rest. If the catalog ever changes these change with it (goldens pin
// the catalog; this list is checked against the client copy by the vitest
// in custom-plan.test.ts via the shared literal).
const PPPPLA_DAYS = [
  'Push 1 - Strength',
  'Pull 1 - Back Thickness',
  'Push 2 - Hypertrophy',
  'Pull 2 - Width / V-Taper',
  'Legs',
  'Aesthetics',
];

interface PlanExercise {
  exercise: string;
  sets: number;
  reps: string;
  reason: string;
}
interface PlanDay {
  day: string;
  goal: string;
  exercises: PlanExercise[];
}

function validatePlan(data: Record<string, unknown>): { plan?: { plan_name: string; rationale: string; days: PlanDay[] }; error?: string } {
  const planName = String(data.plan_name ?? '').trim().slice(0, 60);
  if (!planName) return { error: 'plan_name missing' };
  const days = data.days;
  if (!Array.isArray(days) || days.length !== PPPPLA_DAYS.length) {
    return { error: `expected exactly ${PPPPLA_DAYS.length} days` };
  }
  const seen = new Set<string>();
  const cleanDays: PlanDay[] = [];
  for (const d of days as Record<string, unknown>[]) {
    const day = String(d.day ?? '').trim();
    if (!PPPPLA_DAYS.includes(day)) return { error: `unknown day name: ${day}` };
    if (seen.has(day)) return { error: `duplicate day: ${day}` };
    seen.add(day);
    const exs = d.exercises;
    if (!Array.isArray(exs) || exs.length < 4 || exs.length > 8) {
      return { error: `${day}: 4-8 exercises required` };
    }
    const cleanExs: PlanExercise[] = [];
    for (const e of exs as Record<string, unknown>[]) {
      const exercise = String(e.exercise ?? '').trim().slice(0, 60);
      const reps = String(e.reps ?? '').trim().slice(0, 20);
      if (!exercise || !reps) return { error: `${day}: exercise/reps missing` };
      const sets = Math.max(1, Math.min(8, Math.trunc(Number(e.sets) || 3)));
      cleanExs.push({ exercise, sets, reps, reason: String(e.reason ?? '').trim().slice(0, 200) });
    }
    cleanDays.push({ day, goal: String(d.goal ?? '').trim().slice(0, 120), exercises: cleanExs });
  }
  return { plan: { plan_name: planName, rationale: String(data.rationale ?? '').slice(0, 300), days: cleanDays } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = callerClient(req);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const goal = String(body.goal ?? 'Aesthetics').slice(0, 120);
  const physique = body.physique ?? null;
  const volume = body.volume ?? {};

  const payloadHash = await sha256Hex(JSON.stringify({ goal, physique, volume }));
  const cached = await cachedResult(sb, 'plan', payloadHash);
  if (cached) {
    const v = validatePlan(cached);
    if (v.plan) return json({ result: v.plan, cached: true });
  }

  if (await rateLimited(sb)) {
    return json({ error: 'Hourly AI limit reached. Try again later.' }, 429);
  }

  const userText = `
You are an expert bodybuilding coach making a custom workout plan for an aesthetic-focused lifter.

DO NOT simply repeat a generic PPL routine. Personalise from the data below.

Physique rating (latest AI scan, may be null):
${JSON.stringify(physique, null, 2)}

Recent training volume by muscle (sets):
${JSON.stringify(volume, null, 2)}

Goal: ${goal}

Create a 6-day split whose day names are EXACTLY these, in this order:
${PPPPLA_DAYS.map((d) => `- ${d}`).join('\n')}

Each day: 4-8 exercises. Prefer common gym movements. Include exercise, sets (1-8), reps (e.g. "8-12"), and a short reason tied to the athlete's data.
Return ONLY valid JSON:
{
  "plan_name": "string",
  "rationale": "short summary",
  "days": [
    { "day": "Push 1 - Strength", "goal": "short day goal", "exercises": [ { "exercise": "name", "sets": 3, "reps": "8-12", "reason": "why" } ] }
  ]
}
`;

  const { data, error } = await callOpenAiJson(userText, [], ['plan_name', 'days']);
  if (error || !data) return json({ error: error ?? 'Plan generation failed.' }, 502);

  const v = validatePlan(data);
  if (!v.plan) return json({ error: `The coach returned a malformed plan (${v.error}). Try again.` }, 422);

  await storeCache(sb, 'plan', payloadHash, v.plan as unknown as Record<string, unknown>);
  return json({ result: v.plan, cached: false });
});
