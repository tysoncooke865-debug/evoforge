/**
 * food-match (FUEL, 2026-07-21): the deterministic per-100g layer, now
 * QUALIFIER-AWARE. Import-free on purpose — a pure module the curl matrix
 * (and any future test) can reason about in isolation.
 *
 * THE BUG THIS FIXES: "500g raw 10% beef mince" matched the 'mince' alias to
 * the cooked ~17%-fat `ground beef` row (250 kcal/100g) and DISCARDED the
 * AI's correct raw-10% estimate (~176) → 1250 kcal instead of ~880. The
 * words "raw" and "10%" were structurally ignored.
 *
 * THE RULES:
 *  - Unqualified names keep the old doctrine exactly: same match, same numbers.
 *  - BASE_META declares what state/fat% a base row's figures ASSUME (only
 *    where it matters). Foods not listed are qualifier-agnostic — "raw
 *    banana" still matches `banana`.
 *  - When the parsed qualifiers CONFLICT with the base row's assumption, the
 *    curated VARIANTS answer (USDA figures). No fitting variant → return
 *    null, and the caller falls back to the AI's clamped per-100g estimate
 *    (source:'ai') — an honest estimate beats a confidently wrong table row.
 */

export type Per100 = { kcal: number; p: number; c: number; f: number };

// Curated per-100g factors (kcal, protein, carbs, fat) — cooked weights where
// that is how food lands on a plate. Deterministic: same match, same numbers.
export const FOOD_DB: Record<string, Per100> = {
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

export const ALIASES: Record<string, string> = {
  'chicken': 'chicken breast', 'grilled chicken': 'chicken breast', 'steak': 'beef steak',
  'beef': 'beef steak', 'mince': 'ground beef', 'minced beef': 'ground beef',
  'beef mince': 'ground beef', 'minced meat': 'ground beef', 'rice': 'white rice',
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

/** What a base row's figures ASSUME, for rows where the state/fat% changes
 *  the answer materially. Foods not listed are qualifier-agnostic. */
const BASE_META: Record<string, { state: 'raw' | 'cooked'; fatPct?: number }> = {
  'ground beef': { state: 'cooked', fatPct: 17 },
  'chicken breast': { state: 'cooked' },
  'chicken thigh': { state: 'cooked' },
  'beef steak': { state: 'cooked' },
  'salmon': { state: 'cooked' },
  'white rice': { state: 'cooked' },
  'brown rice': { state: 'cooked' },
  'pasta': { state: 'cooked' },
  'noodles': { state: 'cooked' },
  'oats': { state: 'raw' }, // dry oats — 'oatmeal' is the cooked row
  'oatmeal': { state: 'cooked' },
};

/** Curated qualified rows (USDA figures). A variant without `fatPct` fits any
 *  unstated fat level for its state. */
const VARIANTS: Record<
  string,
  { state: 'raw' | 'cooked'; fatPct?: number; per100: Per100 }[]
> = {
  'ground beef': [
    { state: 'raw', fatPct: 5, per100: { kcal: 137, p: 21.4, c: 0, f: 5 } },
    { state: 'raw', fatPct: 10, per100: { kcal: 176, p: 20, c: 0, f: 10 } },
    { state: 'raw', fatPct: 15, per100: { kcal: 215, p: 18.6, c: 0, f: 15 } },
    { state: 'raw', fatPct: 20, per100: { kcal: 254, p: 17.2, c: 0, f: 20 } },
    { state: 'cooked', fatPct: 5, per100: { kcal: 174, p: 26.6, c: 0, f: 6.6 } },
    { state: 'cooked', fatPct: 10, per100: { kcal: 217, p: 26.1, c: 0, f: 11.7 } },
    { state: 'cooked', fatPct: 15, per100: { kcal: 246, p: 25.9, c: 0, f: 15.3 } },
    { state: 'cooked', fatPct: 20, per100: { kcal: 272, p: 25.8, c: 0, f: 18.2 } },
  ],
  'chicken breast': [{ state: 'raw', per100: { kcal: 120, p: 22.5, c: 0, f: 2.6 } }],
  'chicken thigh': [{ state: 'raw', per100: { kcal: 121, p: 19.7, c: 0, f: 4.7 } }],
  'beef steak': [{ state: 'raw', per100: { kcal: 198, p: 19.4, c: 0, f: 13 } }],
  'white rice': [{ state: 'raw', per100: { kcal: 365, p: 7.1, c: 80, f: 0.7 } }],
  'brown rice': [{ state: 'raw', per100: { kcal: 370, p: 7.9, c: 77, f: 2.9 } }],
  'pasta': [{ state: 'raw', per100: { kcal: 371, p: 13, c: 75, f: 1.5 } }],
  'noodles': [{ state: 'raw', per100: { kcal: 384, p: 14, c: 71, f: 4.4 } }],
  'oats': [{ state: 'cooked', per100: { kcal: 71, p: 2.5, c: 12, f: 1.5 } }],
  'oatmeal': [{ state: 'raw', per100: { kcal: 389, p: 17, c: 66, f: 6.9 } }],
  // salmon: raw is farmed-vs-wild ambiguous (208 vs 142/100g) — no variant on
  // purpose; "raw salmon" falls to the AI estimate, which can read the context.
};

const RAW_RE = /\b(raw|uncooked|dry|dried)\b/;
const COOKED_RE =
  /\b(cooked|grilled|fried|pan[- ]?fried|air[- ]?fried|roasted|baked|boiled|poached|steamed|browned|seared|bbq|barbecued)\b/;
const LEAN_PCT_RE = /(\d{1,2}(?:\.\d)?)\s*%\s*lean/;
const RATIO_RE = /\b(\d{2})\s*\/\s*(\d{1,2})\b/; // "90/10" = lean/fat
const PLAIN_PCT_RE = /(\d{1,2}(?:\.\d)?)\s*%/;

export interface Qualifiers {
  state: 'raw' | 'cooked' | null;
  fatPct: number | null;
}

/** Preparation state and fat% from a food name (or the user's own words).
 *  A plain "N%" ≥ 50 reads as a LEAN figure ("93% mince" means 93% lean);
 *  below 50 it is the fat figure ("10% mince", "10% fat"). */
export function parseQualifiers(name: string): Qualifiers {
  const n = name.toLowerCase();
  const state = RAW_RE.test(n) ? 'raw' : COOKED_RE.test(n) ? 'cooked' : null;
  let fatPct: number | null = null;
  const lean = n.match(LEAN_PCT_RE);
  const ratio = n.match(RATIO_RE);
  const plain = n.match(PLAIN_PCT_RE);
  if (lean) fatPct = 100 - Number(lean[1]);
  else if (ratio) fatPct = Number(ratio[2]);
  else if (plain) {
    const v = Number(plain[1]);
    fatPct = v >= 50 ? 100 - v : v;
  }
  if (fatPct !== null && (fatPct <= 0 || fatPct >= 60)) fatPct = null; // nonsense
  return { state, fatPct };
}

/** The old candidate search, unchanged: direct key/alias, then the longest
 *  FOOD_DB-key substring, then the longest ALIAS substring. */
function findBase(n: string): { key: string; per100: Per100 } | null {
  const direct = FOOD_DB[n] ? n : ALIASES[n];
  if (direct && FOOD_DB[direct]) return { key: direct, per100: FOOD_DB[direct] };
  let best: string | null = null;
  for (const k of Object.keys(FOOD_DB)) if (n.includes(k) && (!best || k.length > best.length)) best = k;
  if (best) return { key: best, per100: FOOD_DB[best] };
  let bestAlias: string | null = null;
  let bestLen = 0;
  for (const [a, k] of Object.entries(ALIASES)) {
    if (n.includes(a) && a.length > bestLen) {
      bestAlias = k;
      bestLen = a.length;
    }
  }
  return bestAlias && FOOD_DB[bestAlias] ? { key: bestAlias, per100: FOOD_DB[bestAlias] } : null;
}

/**
 * Match a food name to deterministic per-100g factors.
 *
 * `fallbackQualifierText` — the user's own words (describe text / photo hint),
 * consulted ONLY when the AI-returned name carries no qualifiers itself. The
 * caller passes it only for single-item results: in a multi-food description,
 * "raw" next to the mince must not re-state the rice.
 *
 * Returns null when the name carries qualifiers the table cannot model —
 * the caller then uses the AI's clamped per-100g estimate (source:'ai').
 */
export function matchFood(
  raw: string,
  fallbackQualifierText?: string
): { key: string; per100: Per100 } | null {
  const n = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const base = findBase(n);
  if (!base) return null;

  const meta = BASE_META[base.key];
  if (!meta) return base; // qualifier-agnostic food: doctrine unchanged

  let q = parseQualifiers(n);
  if (q.state === null && q.fatPct === null && fallbackQualifierText) {
    q = parseQualifiers(fallbackQualifierText);
  }
  // A fat% with no state reads as the LABEL figure — labels describe raw product.
  const wantState = q.state ?? (q.fatPct !== null ? 'raw' : null);
  const stateOk = wantState === null || wantState === meta.state;
  const fatOk =
    q.fatPct === null || (meta.fatPct !== undefined && Math.abs(meta.fatPct - q.fatPct) <= 2);
  if (stateOk && fatOk) return base;

  const state = wantState ?? meta.state;
  const candidates = (VARIANTS[base.key] ?? []).filter((v) => v.state === state);
  let pick: (typeof candidates)[number] | null = null;
  if (q.fatPct !== null) {
    pick = candidates.find((v) => v.fatPct !== undefined && Math.abs(v.fatPct - q.fatPct!) <= 2) ?? null;
  } else if (candidates.length > 0) {
    // Fat unstated: the variant closest to the base row's own fat level —
    // "raw mince" means the same mince as ever, just weighed before cooking.
    const ref = meta.fatPct;
    pick = candidates.reduce<(typeof candidates)[number] | null>((best, v) => {
      if (ref === undefined || v.fatPct === undefined) return best ?? v;
      if (!best || best.fatPct === undefined) return v;
      return Math.abs(v.fatPct - ref) < Math.abs(best.fatPct - ref) ? v : best;
    }, null);
  }
  if (!pick) return null; // qualified beyond the table → AI estimate

  const label = `${base.key} (${pick.state}${pick.fatPct !== undefined ? ` ${pick.fatPct}%` : ''})`;
  return { key: label, per100: pick.per100 };
}
