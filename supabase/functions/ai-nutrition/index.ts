/**
 * ai-nutrition (FUEL, nutrition branch): the calorie-target intake assistant.
 *
 * THE CONTRACT: the AI asks; the domain computes. This function returns either
 * the next intake QUESTION or the completed FIELDS (age, activity, goal, rate,
 * plus any body facts the profile lacked) — it NEVER returns a calorie number.
 * The client computes the target with domain/nutrition.ts::dailyTarget and the
 * athlete confirms it before anything is saved, under their own RLS.
 *
 * Field ranges are validated HERE, server-side, mirroring INTAKE_LIMITS in
 * domain/nutrition.ts — a malformed extraction is a 422, not a target.
 */

import { CORS_HEADERS, callOpenAiJson, callerClient, json, rateLimited, sha256Hex, storeCache } from '../_shared/ai.ts';

const ACTIVITIES = ['sedentary', 'light', 'moderate', 'active', 'very'] as const;
const GOALS = ['lose', 'maintain', 'gain'] as const;
const FIELDS = ['age', 'weightKg', 'heightCm', 'sex', 'activity', 'goal', 'ratePerWeekKg'] as const;

// Mirrors client/src/domain/nutrition.ts INTAKE_LIMITS. Change both together.
const LIMITS: Record<string, { min: number; max: number }> = {
  age: { min: 13, max: 100 },
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 120, max: 230 },
  ratePerWeekKg: { min: 0, max: 1 },
};

/** History window sent to the model — BOTH roles, so this must be roomy.
 *  The old cap (12, both-roles, >= refusal) died at the 6th exchange: a
 *  seven-field intake with free-text answers hit it mid-conversation and
 *  RECALCULATE always failed for athletes with sparse profiles (Tyson,
 *  2026-07-19: "answers all the questions then says too many questions"). */
const MAX_TURNS = 24;
/** The refusal now counts what it means to count: the athlete's ANSWERS. */
const MAX_QUESTIONS = 10;

interface Known {
  age?: number;
  weightKg?: number;
  heightCm?: number;
  sex?: string;
  activity?: string;
  goal?: string;
  ratePerWeekKg?: number;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The caller's facts, coerced and bounded. Garbage in the body is dropped. */
function cleanKnown(raw: Record<string, unknown>): Known {
  const k: Known = {};
  for (const f of ['age', 'weightKg', 'heightCm', 'ratePerWeekKg'] as const) {
    const n = num(raw[f]);
    if (n !== undefined && n >= LIMITS[f].min && n <= LIMITS[f].max) k[f] = n;
  }
  const sex = String(raw.sex ?? '');
  if (sex === 'male' || sex === 'female') k.sex = sex;
  const activity = String(raw.activity ?? '');
  if ((ACTIVITIES as readonly string[]).includes(activity)) k.activity = activity;
  const goal = String(raw.goal ?? '');
  if ((GOALS as readonly string[]).includes(goal)) k.goal = goal;
  return k;
}

function missingFields(k: Known): string[] {
  const missing: string[] = [];
  for (const f of FIELDS) {
    if (f === 'ratePerWeekKg' && k.goal === 'maintain') continue;
    if (k[f] === undefined) missing.push(f);
  }
  return missing;
}

interface ResultFields {
  age: number;
  weightKg: number;
  heightCm: number;
  sex: string;
  activity: string;
  goal: string;
  ratePerWeekKg: number;
}

type Verdict =
  | { type: 'question'; field: string; text: string; chips: string[] }
  | { type: 'result'; fields: ResultFields };

/** Never trust the model's shape (the ai-plan rule). */
function validateVerdict(data: Record<string, unknown>): { verdict?: Verdict; error?: string } {
  const type = String(data.type ?? '');

  if (type === 'question') {
    const field = String(data.field ?? '');
    if (!(FIELDS as readonly string[]).includes(field)) return { error: `unknown field: ${field}` };
    const text = String(data.text ?? '').trim().slice(0, 200);
    if (!text) return { error: 'question with no text' };
    const chips = (Array.isArray(data.chips) ? data.chips : [])
      .map((c) => String(c).trim().slice(0, 40))
      .filter((c) => c !== '')
      .slice(0, 6);
    return { verdict: { type: 'question', field, text, chips } };
  }

  if (type === 'result') {
    const f = cleanKnown((data.fields ?? {}) as Record<string, unknown>);
    if (f.goal === 'maintain') f.ratePerWeekKg = 0;
    const missing = missingFields(f);
    if (missing.length > 0) return { error: `result missing/invalid: ${missing.join(', ')}` };
    return { verdict: { type: 'result', fields: f as unknown as ResultFields } };
  }

  return { error: `unknown verdict type: ${type}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sb = callerClient(req);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const known = cleanKnown((body.known ?? {}) as Record<string, unknown>);
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-MAX_TURNS)
    .map((m: Record<string, unknown>) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: String(m.text ?? '').slice(0, 300),
    }));
  const userTurns = messages.filter((m: { role: string }) => m.role === 'user').length;
  if (userTurns >= MAX_QUESTIONS) {
    return json({ error: 'That is a lot of questions — set the target manually instead.' }, 422);
  }

  // Everything already known? No model call needed — the intake is done.
  if (missingFields(known).length === 0) {
    const fields = { ...known, ratePerWeekKg: known.goal === 'maintain' ? 0 : known.ratePerWeekKg! };
    return json({ result: { type: 'result', fields } });
  }

  if (await rateLimited(sb)) {
    return json({ error: 'Hourly AI limit reached. Set the target manually or try later.' }, 429);
  }

  const userText = `
You are the intake assistant for a fitness app's daily calorie-target calculator.
You NEVER calculate calories. You only gather fields; the app does the math.

Fields, with allowed values:
- age: integer 13-100
- weightKg: number 30-300
- heightCm: number 120-230
- sex: "male" | "female"
- activity: "sedentary" | "light" | "moderate" | "active" | "very"
- goal: "lose" | "maintain" | "gain"
- ratePerWeekKg: number 0-1 (kg per week; only needed when goal is not "maintain")

Already known (do NOT ask about these):
${JSON.stringify(known, null, 2)}

Conversation so far (you asked, the athlete answered — interpret their answers,
including casual phrasing, units like lbs/ft, and typos):
${JSON.stringify(messages, null, 2)}

If any field is still unknown, ask about EXACTLY ONE missing field — friendly,
one sentence, second person. Offer tappable "chips" when the field is enumerable
(activity, goal, ratePerWeekKg e.g. ["0.25","0.5","0.75","1"]).

Return ONLY valid JSON, one of:
{ "type": "question", "field": "<field>", "text": "…", "chips": ["…"] }
{ "type": "result", "fields": { "age": 0, "weightKg": 0, "heightCm": 0, "sex": "…", "activity": "…", "goal": "…", "ratePerWeekKg": 0 } }
`;

  const { data, error } = await callOpenAiJson(userText, [], ['type']);
  if (error || !data) return json({ error: error ?? 'Intake failed.' }, 502);

  const v = validateVerdict(data);
  if (!v.verdict) return json({ error: `Malformed intake step (${v.error}). Try again.` }, 422);

  // A COMPLETED intake counts toward the hourly AI budget (the limiter reads
  // ai_scan_cache); per-question turns stay cheap and uncounted, bounded by
  // MAX_TURNS instead.
  if (v.verdict.type === 'result') {
    const hash = await sha256Hex(JSON.stringify({ kind: 'nutrition', known, messages }));
    await storeCache(sb, 'nutrition', hash, v.verdict as unknown as Record<string, unknown>);
  }

  return json({ result: v.verdict });
});
