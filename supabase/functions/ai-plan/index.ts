/**
 * ai-plan (IMPROVEMENT_PLAN #10): the AI custom routine, ported from
 * services/ai_physique.py::run_ai_custom_plan_from_physique. Returns the
 * validated plan WITHOUT saving — the client previews and the athlete's
 * accept writes the rows under their own RLS. Never trust the model's
 * shape: day names must be EXACTLY the six PPPPLA days so scheduling and
 * logging map 1:1, sets clamp to 1–8, strings are bounded.
 */

import { CORS_HEADERS, FAST_MODEL, callOpenAiJson, callerClient, cachedResult, json, rateLimited, sha256Hex, storeCache } from '../_shared/ai.ts';
import { CORE_NAME_BY_ID, EXERCISE_IDS, PLAN_EXERCISES } from '../_shared/exercise-catalogue.ts';

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

/**
 * AI GENERATES PROGRAMMING. EVOFORGE OWNS EXERCISE IDENTITY (2026-08-10).
 *
 * This function used to return `{ exercise: "Bench Press (Strength Focused)" }`
 * and that string became the exercise's identity in workout_log — so the
 * athlete's four years of `Bench Press` vanished the moment a plan was forged:
 * no "last time", no prefill, no PR baseline. Production still carries the
 * scar (43 rows under `Barbell Bench Press (Strength)` beside 42 under
 * `Barbell Bench Press`, repaired by migration 193).
 *
 * The fix is structural, not a filter. IDENTITY and PRESCRIPTION are now
 * different fields:
 *
 *   exercise_id      chosen from EvoForge's catalogue. Required.
 *   exercise         the CANONICAL name, written by us from that id — never
 *                    by the model. This is what lands in the database.
 *   training_focus   'strength' | 'hypertrophy' | ... — where "Strength
 *   rep_min/rep_max  Focused" was always trying to go
 *   rir / tempo
 *   reason           the coaching note
 *
 * A model that renames a lift can no longer mint one: `exercise` is derived
 * from a validated id, and an unrecognised id falls back to the model's
 * display name, which the CLIENT resolver then canonicalises on read. There
 * is no path by which wording becomes identity.
 */
interface PlanExercise {
  exercise: string;
  exercise_id?: string;
  sets: number;
  reps: string;
  reason: string;
  training_focus?: string;
  rep_min?: number;
  rep_max?: number;
  rir?: number;
  tempo?: string;
}
interface PlanDay {
  day: string;
  goal: string;
  exercises: PlanExercise[];
}

const FOCUSES = ['strength', 'hypertrophy', 'power', 'endurance', 'technique'];

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
      const reps = String(e.reps ?? '').trim().slice(0, 20);
      const rawId = String(e.exercise_id ?? '').trim().toLowerCase();
      // `display_name` is the model's own wording; `exercise` is accepted too
      // so a cached pre-2026-08-10 plan still validates.
      const display = String(e.display_name ?? e.exercise ?? '').trim().slice(0, 60);

      // THE ONE RULE. A real catalogue id names the exercise, and the name we
      // store is the CATALOGUE's, not the model's. An unrecognised id is
      // discarded rather than trusted — a model cannot mint an identity by
      // writing one down — and the display name carries through for the
      // client resolver to canonicalise on read.
      const known = rawId !== '' && EXERCISE_IDS.has(rawId);
      const exercise = known ? (CORE_NAME_BY_ID[rawId] ?? display) : display;
      if (!exercise || !reps) return { error: `${day}: exercise/reps missing` };

      const sets = Math.max(1, Math.min(8, Math.trunc(Number(e.sets) || 3)));
      const focus = String(e.training_focus ?? '').trim().toLowerCase();
      const num = (v: unknown, lo: number, hi: number): number | undefined => {
        const n = Math.trunc(Number(v));
        return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
      };
      cleanExs.push({
        exercise,
        ...(known ? { exercise_id: rawId } : {}),
        sets,
        reps,
        reason: String(e.reason ?? '').trim().slice(0, 200),
        ...(FOCUSES.includes(focus) ? { training_focus: focus } : {}),
        ...(num(e.rep_min, 1, 100) !== undefined ? { rep_min: num(e.rep_min, 1, 100) } : {}),
        ...(num(e.rep_max, 1, 100) !== undefined ? { rep_max: num(e.rep_max, 1, 100) } : {}),
        ...(num(e.rir, 0, 10) !== undefined ? { rir: num(e.rir, 0, 10) } : {}),
        ...(String(e.tempo ?? '').trim() ? { tempo: String(e.tempo).trim().slice(0, 20) } : {}),
      });
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

  // PROMPT_VERSION is part of the cache key on purpose: a plan cached under
  // the old prompt carries free-form exercise names and no ids, and would be
  // served forever to anyone with the same goal/physique/volume. Bump this
  // whenever the prompt's CONTRACT changes, not when its wording is tidied.
  const PROMPT_VERSION = 2; // 2 = canonical exercise ids (2026-08-10)
  const payloadHash = await sha256Hex(JSON.stringify({ goal, physique, volume, v: PROMPT_VERSION }));
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

Each day: 4-8 exercises.

EXERCISE IDENTITY — READ THIS TWICE.

NEVER CREATE A NEW EXERCISE IDENTITY BY CHANGING AN EXERCISE'S NAME. Use an
existing canonical exercise_id from the EvoForge exercise library below
whenever the exercise already exists. Store training focus, rep scheme, tempo,
intensity, grip instructions and coaching notes SEPARATELY from the exercise's
identity — in training_focus, rep_min, rep_max, rir, tempo and reason.

"Bench Press (Strength Focused)" is NOT an exercise. It is the exercise
barbell_bench_press with training_focus "strength". Writing the focus into the
name destroys the athlete's history for that lift, because EvoForge matches
their previous sets, their personal records and their progression on the
exercise's identity — not on the words you chose.

Pick exercise_id from this library (id — name — primary muscle):
${PLAN_EXERCISES.map((e) => `${e.id} — ${e.name} — ${e.muscle}`).join('\n')}

If a movement you want genuinely is not in that list, still fill display_name
with the plain, unadorned name of the movement (no focus, no rep scheme, no
brackets) and omit exercise_id.

Return ONLY valid JSON:
{
  "plan_name": "string",
  "rationale": "short summary",
  "days": [
    { "day": "Push 1 - Strength", "goal": "short day goal", "exercises": [
      {
        "exercise_id": "barbell_bench_press",
        "display_name": "Barbell Bench Press",
        "training_focus": "strength",
        "sets": 4,
        "reps": "4-6",
        "rep_min": 4,
        "rep_max": 6,
        "rir": 2,
        "reason": "why, tied to the athlete's data"
      }
    ] }
  ]
}
`;

  // Plan generation is templated extraction, not judgment — the mini model
  // with low effort is ~5× cheaper and faster, and validatePlan() is the
  // real quality gate either way.
  const { data, error } = await callOpenAiJson(userText, [], ['plan_name', 'days'], FAST_MODEL, 'low');
  if (error || !data) return json({ error: error ?? 'Plan generation failed.' }, 502);

  const v = validatePlan(data);
  if (!v.plan) return json({ error: `The coach returned a malformed plan (${v.error}). Try again.` }, 422);

  await storeCache(sb, 'plan', payloadHash, v.plan as unknown as Record<string, unknown>);
  return json({ result: v.plan, cached: false });
});
