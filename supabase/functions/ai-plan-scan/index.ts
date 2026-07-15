/**
 * ai-plan-scan (PLAN SCAN, 2026-07-15): read a photographed or typed workout
 * into a structured plan.
 *
 * THE AI TRANSCRIBES; IT NEVER AUTHORS. The prompt forbids inventing exercises
 * that are not on the page, and the client re-maps every returned name against
 * the real exercise library (domain/workout-import.ts) — a hallucinated name
 * cannot reach MY PLAN because only library names survive that mapping (the
 * user sees anything unmatched, flagged).
 *
 * VALIDATOR IS DELIBERATELY RELAXED vs ai-plan's: imported workouts have their
 * own day names and day counts — pinning the six PPPPLA names here would
 * reject every real-world page. Bounds still hold: 1–7 days, 1–15 exercises
 * per day, strings sliced, sets clamped.
 *
 * Photos are read and DISCARDED (the solo-photo doctrine); only the payload
 * sha lands in ai_scan_cache (kind 'plan-scan') for the cache + hourly limit.
 */

import { CORS_HEADERS, FAST_MODEL, callOpenAiJson, callerClient, cachedResult, json, rateLimited, sha256Hex, storeCache } from '../_shared/ai.ts';

const MAX_IMAGES = 3;
const MAX_TEXT = 4000;

// The canonical muscle tags — mirrors client exercise-taxonomy MUSCLE_GROUPS.
// A guess outside this list is dropped, never coerced: a wrong tag pollutes
// the athlete's heat map and skill tree; a missing one just leaves the manual
// create path (which asks) in charge.
const MUSCLE_TAGS = [
  'Chest', 'Upper Chest',
  'Back Width', 'Back Thickness', 'Traps', 'Erectors',
  'Side Delts', 'Rear Delts', 'Front Delts',
  'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abductors',
  'Abs',
] as const;

interface ScannedExercise {
  raw: string;
  exercise: string;
  sets: number;
  reps: string;
  /** AI best-guess primary muscle, one of MUSCLE_TAGS — used only when the
   *  client's corpus cannot claim the exercise. */
  muscle?: string;
}
interface ScannedDay {
  day: string;
  exercises: ScannedExercise[];
}
interface ScannedPlan {
  plan_name: string;
  days: ScannedDay[];
}

function validateScan(data: Record<string, unknown>): { plan?: ScannedPlan; error?: string } {
  const planName = String(data.plan_name ?? '').trim().slice(0, 60) || 'Imported Workout';
  const rawDays = data.days;
  if (!Array.isArray(rawDays) || rawDays.length === 0) return { error: 'no days found' };

  const seen = new Set<string>();
  const days: ScannedDay[] = [];
  for (const d of rawDays.slice(0, 7) as Record<string, unknown>[]) {
    let day = String(d.day ?? '').trim().slice(0, 40);
    if (!day) day = `Day ${days.length + 1}`;
    if (seen.has(day.toLowerCase())) day = `${day} (${days.length + 1})`.slice(0, 40);
    seen.add(day.toLowerCase());

    const exs = d.exercises;
    if (!Array.isArray(exs)) return { error: `${day}: exercises missing` };
    const clean: ScannedExercise[] = [];
    for (const e of (exs as Record<string, unknown>[]).slice(0, 15)) {
      const raw = String(e.raw ?? e.exercise ?? '').trim().slice(0, 60);
      const exercise = String(e.exercise ?? e.raw ?? '').trim().slice(0, 60);
      if (!raw || !exercise) continue; // an unreadable line is skipped, not fatal
      const sets = Math.max(1, Math.min(8, Math.trunc(Number(e.sets) || 3)));
      const reps = String(e.reps ?? '8-12').trim().slice(0, 20) || '8-12';
      const muscle = String(e.muscle ?? '').trim();
      clean.push({
        raw,
        exercise,
        sets,
        reps,
        ...((MUSCLE_TAGS as readonly string[]).includes(muscle) ? { muscle } : {}),
      });
    }
    if (clean.length === 0) continue; // an empty day is dropped, not fatal
    days.push({ day, exercises: clean });
  }
  if (days.length === 0) return { error: 'no readable exercises on the page' };
  return { plan: { plan_name: planName, days } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = callerClient(req);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('data:image/'))
    .slice(0, MAX_IMAGES) as string[];
  const text = String(body.text ?? '').slice(0, MAX_TEXT).trim();
  if (images.length === 0 && text === '') {
    return json({ error: 'Nothing to read — add a photo or some text.' }, 422);
  }

  const payloadHash = await sha256Hex(JSON.stringify({ images, text }));
  const cached = await cachedResult(sb, 'plan-scan', payloadHash);
  if (cached) {
    const v = validateScan(cached);
    if (v.plan) return json({ result: v.plan, cached: true });
  }

  if (await rateLimited(sb)) {
    return json({ error: 'Hourly AI limit reached. Try again later.' }, 429);
  }

  const userText = `
You are transcribing a workout program from ${images.length > 0 ? 'the attached photo(s) of a written/typed workout' : 'the text below'}.

RULES — transcription, not authorship:
- Include ONLY exercises that actually appear. NEVER add, remove or reorder exercises.
- For each exercise return BOTH the text as written ("raw") and your best-guess
  normalized common gym name ("exercise") — expand shorthand and fix spelling:
  "inc db prss" -> "Incline Dumbbell Press", "rdl" -> "Romanian Deadlift".
- Parse sets/reps where written ("5x5" -> sets 5, reps "5"; "3x8-12" -> sets 3,
  reps "8-12"). Where absent, use sets 3, reps "8-12".
- For each exercise include "muscle": your best guess at the PRIMARY muscle it
  trains, chosen from EXACTLY this list (verbatim):
  ${MUSCLE_TAGS.join(' | ')}
- Group into days exactly as the page groups them (headings, columns, day labels).
  If the page is one undivided list, return ONE day named from the page's title,
  else "Workout".
- plan_name: the program's title if the page has one, else a short honest name.
${text !== '' ? `\nTHE TEXT:\n${text}\n` : ''}
Return ONLY valid JSON:
{
  "plan_name": "string",
  "days": [
    { "day": "string", "exercises": [ { "raw": "as written", "exercise": "normalized", "sets": 3, "reps": "8-12", "muscle": "Chest" } ] }
  ]
}
`;

  // Transcription, not judgment — mini + low effort reads a written page
  // fine, ~5× cheaper and faster; validateScan() gates quality.
  const { data, error } = await callOpenAiJson(userText, images, ['days'], FAST_MODEL, 'low');
  if (error || !data) return json({ error: error ?? 'The scan failed.' }, 502);

  const v = validateScan(data);
  if (!v.plan) return json({ error: `Could not read a workout from that (${v.error}). Try a clearer photo or paste the text.` }, 422);

  await storeCache(sb, 'plan-scan', payloadHash, v.plan as unknown as Record<string, unknown>);
  return json({ result: v.plan, cached: false });
});
