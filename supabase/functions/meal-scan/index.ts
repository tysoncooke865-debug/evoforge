/**
 * meal-scan (FUEL, 2026-07-18): the photo calorie calculator.
 *
 * THE CONTRACT (the Fuel doctrine): the AI IDENTIFIES foods and ESTIMATES the
 * visible grams; the NUMBERS come from deterministic logic — a curated
 * per-100g food table matched by normalised name/alias, plain multiplication
 * for kcal and macros. Foods the table doesn't know fall back to the AI's own
 * per-100g estimate, flagged `source:'ai'` so the client can show it as an
 * estimate. NOTHING IS STORED HERE — the athlete corrects portions and
 * confirms on the client, which saves under its own RLS.
 *
 * QUALIFIER-AWARE (2026-07-21): the table/matcher live in ./food-match.ts.
 * Preparation state (raw/cooked) and fat/lean % are DATA now: "raw 10% beef
 * mince" resolves to a curated raw-10% variant (176 kcal/100g) instead of the
 * cooked base row (250), and a qualified food the table can't model falls
 * back to the AI estimate rather than a confidently wrong table figure.
 */

import { CORS_HEADERS, callOpenAiJson, json } from '../_shared/ai.ts';
import { callerUserId } from '../_shared/battle/service.ts';
import { matchFood, type Per100 } from './food-match.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;

// Both prompts carry this: dropped qualifiers were the root of the raw-mince
// overestimate — the matcher can only honour what the model echoes through.
const QUALIFIER_RULE = `
QUALIFIERS ARE DATA: if a preparation state (raw, cooked, grilled, dry) or a
fat/lean percentage ("10% fat", "90/10", "95% lean") is stated, echo it
VERBATIM into that item's "name" — never drop or normalise it. Grams follow
the stated state: a raw weight stays the raw weight (do not convert raw to
cooked or vice versa), and your per-100g estimate must describe the SAME
state as the name.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const image = String(body.image ?? '');
  const text = String(body.text ?? '').trim();
  // Optional athlete hint for the PHOTO path (2026-07-19): "it's turkey not
  // chicken", "the sauce is sugar-free". Bounded server-side; identification
  // only — the deterministic table still owns every number.
  const hint = String(body.hint ?? '').trim().slice(0, 200);
  const isRecipe = body.mode === 'recipe';
  const hasImage = image.startsWith('data:image/');
  // Two input modes, one output: a PHOTO, or a free-text meal description /
  // recipe. Either way the AI only identifies foods + estimates grams; the
  // deterministic table + multiplication below own the numbers.
  if (!hasImage && text.length < 3)
    return json({ error: 'A meal photo or a text description is required.' }, 400);

  const photoPrompt = `
Identify the foods in this meal photo for a calorie tracker. For EACH distinct
food, estimate the VISIBLE quantity in grams (edible portion, as served —
consider plate size and typical servings). Do not identify people. If unsure of
a food, give your best common-food name. For foods that are unusual or branded,
also include your best per-100g estimate.${
    hint
      ? `
The user adds this context about their meal — trust it for IDENTIFYING foods
(it corrects what the photo alone can't show), never for inventing foods that
are not visible: """${hint}"""`
      : ''
  }${QUALIFIER_RULE} Return ONLY valid JSON:
{
  "items": [
    { "name": "grilled chicken breast", "grams": 180,
      "per100_kcal": 165, "per100_protein": 31, "per100_carbs": 0, "per100_fat": 3.6 }
  ],
  "is_food": true,      // false if the photo clearly shows no food
  "notes": "one short sentence"
}`;

  // The text path covers "describe my meal" and "paste a recipe" — the client
  // sends mode:'recipe' for the latter. Recipe mode ALWAYS returns one
  // serving: divide by the stated serving count, or assume 1 when none given.
  const recipeRule = isRecipe
    ? `This is a RECIPE. Output ONE SERVING: if a serving count is stated, divide
every gram amount by it; if NO serving count is given, assume the recipe makes
1 serving and return it whole. Always state the assumed servings in notes.`
    : `This is a described meal (already one portion). Do not divide by servings.`;
  const textPrompt = `
A user entered this for a calorie tracker:
"""
${text.slice(0, 1500)}
"""
${recipeRule}
Extract EACH distinct food and its quantity in grams. Convert household
measures to grams (e.g. "2 eggs" -> 100 g, "1 cup cooked rice" -> 200 g,
"a tbsp olive oil" -> 14 g). For unusual or branded foods include your best
per-100g estimate.${QUALIFIER_RULE}
Set is_food=false only if the text describes no food at all.
Return ONLY valid JSON:
{
  "items": [
    { "name": "egg", "grams": 100,
      "per100_kcal": 155, "per100_protein": 13, "per100_carbs": 1.1, "per100_fat": 11 }
  ],
  "is_food": true,
  "notes": "one short sentence (state assumed servings for a recipe)"
}`;

  const { data, error } = await callOpenAiJson(
    hasImage ? photoPrompt : textPrompt,
    hasImage ? [image] : [],
    ['items', 'is_food']
  );
  if (error || !data) return json({ error: error ?? 'The scanner returned nothing.' }, 502);
  if (!data.is_food)
    return json(
      { error: hasImage ? "That doesn't look like food — try a clearer photo of the meal." : "That doesn't read as food — describe what you ate." },
      422
    );

  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  // The user's own words back up the AI name as a qualifier source — but ONLY
  // for a single-item result: in a multi-food description, "raw" beside the
  // mince must not re-state the rice.
  const qualifierFallback = rawItems.length === 1 ? (hasImage ? hint : text) : undefined;
  const items = rawItems.slice(0, 12).map((it) => {
    const name = String(it.name ?? 'food').slice(0, 60);
    const grams = Math.max(1, Math.min(2000, Math.round(Number(it.grams) || 100)));
    const hit = matchFood(name, qualifierFallback);
    // DETERMINISTIC factors: the curated table when it knows the food (state
    // and fat % included), the AI's per-100g estimate (sanity-clamped) when
    // it doesn't.
    const per100: Per100 = hit
      ? hit.per100
      : {
          kcal: Math.max(5, Math.min(900, Math.round(Number(it.per100_kcal) || 150))),
          p: Math.max(0, Math.min(90, round1(Number(it.per100_protein) || 5))),
          c: Math.max(0, Math.min(100, round1(Number(it.per100_carbs) || 15))),
          f: Math.max(0, Math.min(100, round1(Number(it.per100_fat) || 5))),
        };
    return {
      name,
      grams,
      per100,
      source: hit ? 'db' : 'ai',
      matched: hit?.key ?? null,
    };
  });
  if (items.length === 0)
    return json({ error: hasImage ? 'No foods identified — try a closer, clearer photo.' : 'No foods identified — add more detail.' }, 422);

  // Pure multiplication — the client mirrors this exactly during corrections.
  const totals = items.reduce(
    (t, it) => ({
      kcal: t.kcal + Math.round((it.grams * it.per100.kcal) / 100),
      p: round1(t.p + (it.grams * it.per100.p) / 100),
      c: round1(t.c + (it.grams * it.per100.c) / 100),
      f: round1(t.f + (it.grams * it.per100.f) / 100),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );

  return json({ result: { items, totals, notes: String(data.notes ?? '') } });
});
