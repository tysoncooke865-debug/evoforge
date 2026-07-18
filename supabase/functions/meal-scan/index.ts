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
 */

import { CORS_HEADERS, callOpenAiJson, json } from '../_shared/ai.ts';
import { callerUserId } from '../_shared/battle/service.ts';

type Per100 = { kcal: number; p: number; c: number; f: number };

// Curated per-100g factors (kcal, protein, carbs, fat) — cooked weights where
// that is how food lands on a plate. Deterministic: same match, same numbers.
const FOOD_DB: Record<string, Per100> = {
  'chicken breast': { kcal: 165, p: 31, c: 0, f: 3.6 },
  'chicken thigh': { kcal: 209, p: 26, c: 0, f: 11 },
  'beef steak': { kcal: 271, p: 26, c: 0, f: 18 },
  'ground beef': { kcal: 250, p: 26, c: 0, f: 15 },
  'pork chop': { kcal: 231, p: 25, c: 0, f: 14 },
  'bacon': { kcal: 541, p: 37, c: 1.4, f: 42 },
  'salmon': { kcal: 208, p: 20, c: 0, f: 13 },
  'tuna': { kcal: 132, p: 28, c: 0, f: 1.3 },
  'white fish': { kcal: 105, p: 23, c: 0, f: 1 },
  'shrimp': { kcal: 99, p: 24, c: 0.2, f: 0.3 },
  'egg': { kcal: 155, p: 13, c: 1.1, f: 11 },
  'egg white': { kcal: 52, p: 11, c: 0.7, f: 0.2 },
  'tofu': { kcal: 76, p: 8, c: 1.9, f: 4.8 },
  'white rice': { kcal: 130, p: 2.7, c: 28, f: 0.3 },
  'brown rice': { kcal: 111, p: 2.6, c: 23, f: 0.9 },
  'pasta': { kcal: 158, p: 5.8, c: 31, f: 0.9 },
  'bread': { kcal: 265, p: 9, c: 49, f: 3.2 },
  'whole wheat bread': { kcal: 247, p: 13, c: 41, f: 3.4 },
  'potato': { kcal: 87, p: 1.9, c: 20, f: 0.1 },
  'sweet potato': { kcal: 90, p: 2, c: 21, f: 0.2 },
  'french fries': { kcal: 312, p: 3.4, c: 41, f: 15 },
  'oats': { kcal: 389, p: 17, c: 66, f: 6.9 },
  'oatmeal': { kcal: 71, p: 2.5, c: 12, f: 1.5 },
  'quinoa': { kcal: 120, p: 4.4, c: 21, f: 1.9 },
  'tortilla': { kcal: 312, p: 8.5, c: 51, f: 8 },
  'noodles': { kcal: 138, p: 4.5, c: 25, f: 2.1 },
  'banana': { kcal: 89, p: 1.1, c: 23, f: 0.3 },
  'apple': { kcal: 52, p: 0.3, c: 14, f: 0.2 },
  'orange': { kcal: 47, p: 0.9, c: 12, f: 0.1 },
  'berries': { kcal: 50, p: 0.7, c: 12, f: 0.3 },
  'grapes': { kcal: 69, p: 0.7, c: 18, f: 0.2 },
  'avocado': { kcal: 160, p: 2, c: 8.5, f: 15 },
  'broccoli': { kcal: 34, p: 2.8, c: 7, f: 0.4 },
  'spinach': { kcal: 23, p: 2.9, c: 3.6, f: 0.4 },
  'lettuce': { kcal: 15, p: 1.4, c: 2.9, f: 0.2 },
  'salad greens': { kcal: 17, p: 1.5, c: 3.3, f: 0.2 },
  'tomato': { kcal: 18, p: 0.9, c: 3.9, f: 0.2 },
  'cucumber': { kcal: 15, p: 0.7, c: 3.6, f: 0.1 },
  'carrot': { kcal: 41, p: 0.9, c: 10, f: 0.2 },
  'onion': { kcal: 40, p: 1.1, c: 9.3, f: 0.1 },
  'bell pepper': { kcal: 26, p: 1, c: 6, f: 0.3 },
  'mushroom': { kcal: 22, p: 3.1, c: 3.3, f: 0.3 },
  'corn': { kcal: 96, p: 3.4, c: 21, f: 1.5 },
  'peas': { kcal: 81, p: 5.4, c: 14, f: 0.4 },
  'green beans': { kcal: 31, p: 1.8, c: 7, f: 0.2 },
  'beans': { kcal: 127, p: 8.7, c: 23, f: 0.5 },
  'chickpeas': { kcal: 164, p: 8.9, c: 27, f: 2.6 },
  'lentils': { kcal: 116, p: 9, c: 20, f: 0.4 },
  'hummus': { kcal: 166, p: 7.9, c: 14, f: 9.6 },
  'cheese': { kcal: 402, p: 25, c: 1.3, f: 33 },
  'mozzarella': { kcal: 280, p: 28, c: 3.1, f: 17 },
  'feta': { kcal: 264, p: 14, c: 4.1, f: 21 },
  'cottage cheese': { kcal: 98, p: 11, c: 3.4, f: 4.3 },
  'greek yogurt': { kcal: 59, p: 10, c: 3.6, f: 0.4 },
  'yogurt': { kcal: 61, p: 3.5, c: 4.7, f: 3.3 },
  'milk': { kcal: 61, p: 3.2, c: 4.8, f: 3.3 },
  'butter': { kcal: 717, p: 0.9, c: 0.1, f: 81 },
  'olive oil': { kcal: 884, p: 0, c: 0, f: 100 },
  'peanut butter': { kcal: 588, p: 25, c: 20, f: 50 },
  'almonds': { kcal: 579, p: 21, c: 22, f: 50 },
  'nuts': { kcal: 607, p: 20, c: 21, f: 54 },
  'pizza': { kcal: 266, p: 11, c: 33, f: 10 },
  'burger': { kcal: 295, p: 17, c: 24, f: 14 },
  'hot dog': { kcal: 290, p: 10, c: 4, f: 26 },
  'sushi': { kcal: 150, p: 6, c: 27, f: 1.5 },
  'pancake': { kcal: 227, p: 6.4, c: 28, f: 10 },
  'waffle': { kcal: 291, p: 7.9, c: 33, f: 14 },
  'granola': { kcal: 471, p: 10, c: 64, f: 20 },
  'cereal': { kcal: 379, p: 7, c: 84, f: 1.5 },
  'protein powder': { kcal: 375, p: 75, c: 10, f: 5 },
  'protein bar': { kcal: 380, p: 30, c: 40, f: 12 },
  'chocolate': { kcal: 546, p: 4.9, c: 61, f: 31 },
  'ice cream': { kcal: 207, p: 3.5, c: 24, f: 11 },
  'cookie': { kcal: 488, p: 5.6, c: 65, f: 24 },
  'cake': { kcal: 371, p: 5.4, c: 53, f: 15 },
  'donut': { kcal: 452, p: 4.9, c: 51, f: 25 },
  'chips': { kcal: 536, p: 7, c: 53, f: 34 },
  'soda': { kcal: 41, p: 0, c: 10.6, f: 0 },
  'orange juice': { kcal: 45, p: 0.7, c: 10, f: 0.2 },
  'beer': { kcal: 43, p: 0.5, c: 3.6, f: 0 },
  'wine': { kcal: 83, p: 0.1, c: 2.6, f: 0 },
  'salsa': { kcal: 36, p: 1.5, c: 7, f: 0.2 },
  'ketchup': { kcal: 101, p: 1, c: 27, f: 0.1 },
  'mayonnaise': { kcal: 680, p: 1, c: 0.6, f: 75 },
  'ranch dressing': { kcal: 430, p: 1.3, c: 6, f: 45 },
  'soy sauce': { kcal: 53, p: 8.1, c: 4.9, f: 0.6 },
  'guacamole': { kcal: 155, p: 2, c: 8, f: 14 },
  'bagel': { kcal: 250, p: 10, c: 49, f: 1.5 },
  'croissant': { kcal: 406, p: 8.2, c: 46, f: 21 },
  'wrap': { kcal: 290, p: 8, c: 48, f: 7 },
  'sausage': { kcal: 301, p: 12, c: 2.7, f: 27 },
  'ham': { kcal: 145, p: 21, c: 1.5, f: 5.5 },
  'turkey': { kcal: 135, p: 30, c: 0, f: 1 },
  'lamb': { kcal: 294, p: 25, c: 0, f: 21 },
  'soup': { kcal: 56, p: 3, c: 7, f: 1.7 },
  'fried rice': { kcal: 163, p: 4.2, c: 28, f: 3.5 },
  'mashed potato': { kcal: 113, p: 2, c: 17, f: 4.2 },
  'coleslaw': { kcal: 152, p: 1.2, c: 14, f: 10 },
};

const ALIASES: Record<string, string> = {
  'chicken': 'chicken breast', 'grilled chicken': 'chicken breast', 'steak': 'beef steak',
  'beef': 'beef steak', 'mince': 'ground beef', 'minced beef': 'ground beef', 'rice': 'white rice',
  'spaghetti': 'pasta', 'penne': 'pasta', 'toast': 'bread', 'fries': 'french fries',
  'chips (fries)': 'french fries', 'crisps': 'chips', 'porridge': 'oatmeal', 'eggs': 'egg',
  'scrambled eggs': 'egg', 'fried egg': 'egg', 'boiled egg': 'egg', 'strawberries': 'berries',
  'blueberries': 'berries', 'raspberries': 'berries', 'salad': 'salad greens', 'greens': 'salad greens',
  'capsicum': 'bell pepper', 'mushrooms': 'mushroom', 'tomatoes': 'tomato', 'carrots': 'carrot',
  'black beans': 'beans', 'kidney beans': 'beans', 'cheddar': 'cheese', 'yoghurt': 'yogurt',
  'greek yoghurt': 'greek yogurt', 'pb': 'peanut butter', 'mixed nuts': 'nuts', 'hamburger': 'burger',
  'cheeseburger': 'burger', 'hotdog': 'hot dog', 'pancakes': 'pancake', 'cookies': 'cookie',
  'doughnut': 'donut', 'oj': 'orange juice', 'mayo': 'mayonnaise', 'ranch': 'ranch dressing',
  'sweet potatoes': 'sweet potato', 'potatoes': 'potato', 'roast potato': 'potato',
  'baked potato': 'potato', 'turkey breast': 'turkey', 'deli ham': 'ham', 'noodle': 'noodles',
};

function matchFood(raw: string): { key: string; per100: Per100 } | null {
  const n = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const direct = FOOD_DB[n] ? n : ALIASES[n];
  if (direct && FOOD_DB[direct]) return { key: direct, per100: FOOD_DB[direct] };
  // substring pass: "grilled chicken breast" → 'chicken breast' (longest key wins)
  let best: string | null = null;
  for (const k of Object.keys(FOOD_DB)) if (n.includes(k) && (!best || k.length > best.length)) best = k;
  if (best) return { key: best, per100: FOOD_DB[best] };
  for (const [a, k] of Object.entries(ALIASES)) if (n.includes(a) && (!best || a.length > best.length)) best = k;
  return best && FOOD_DB[best] ? { key: best, per100: FOOD_DB[best] } : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const userId = await callerUserId(req);
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const image = String(body.image ?? '');
  const text = String(body.text ?? '').trim();
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
also include your best per-100g estimate. Return ONLY valid JSON:
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
per-100g estimate. Set is_food=false only if the text describes no food at all.
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
  const items = rawItems.slice(0, 12).map((it) => {
    const name = String(it.name ?? 'food').slice(0, 60);
    const grams = Math.max(1, Math.min(2000, Math.round(Number(it.grams) || 100)));
    const hit = matchFood(name);
    // DETERMINISTIC factors: the curated table when it knows the food, the
    // AI's per-100g estimate (sanity-clamped) when it doesn't.
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
