import type { MealItem } from './nutrition';

/**
 * BARCODE → FOOD (FUEL_REDESIGN): Open Food Facts v2 product lookup. OFF is
 * keyless and CORS-open, so this is a direct browser fetch — the "AI calls go
 * through Edge Functions" rule is a secret-key rule and no secret exists here.
 *
 * The result is a PREFILL, never a write: it lands in the same confirm sheet
 * as the AI meal scan (grams editable, item removable) and saves through the
 * same useLogMeal mutation. Per-100g numbers are normalised here so the
 * client's deterministic scanTotals() math applies unchanged.
 */

export interface BarcodeProduct {
  item: MealItem;
  /** "Brand · Product" for the confirm sheet's header. */
  title: string;
}

const OFF_FIELDS =
  'product_name,brands,serving_quantity,nutrition_data_per,nutriments';

/** EAN-8 / UPC-A / EAN-13 (and the odd 14-digit case). */
export function isBarcode(code: string): boolean {
  return /^\d{8,14}$/.test(code.trim());
}

const num = (v: unknown): number | null => {
  // null/'' coerce to 0 under Number() — that would masquerade as a real
  // zero and skip the kJ / per-serving fallbacks. Missing means missing.
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** kJ → kcal when OFF only carries energy_100g (kJ). */
const KJ_PER_KCAL = 4.184;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

interface OffNutriments {
  [key: string]: unknown;
}

/** Per-100g macros from OFF's nutriments, deriving from per-serving numbers
 *  when the product only declares those. Null when kcal is unrecoverable. */
function per100From(
  nutriments: OffNutriments,
  dataPer: string | undefined,
  servingQuantity: number | null
): MealItem['per100'] | null {
  const direct = {
    kcal: num(nutriments['energy-kcal_100g']),
    p: num(nutriments['proteins_100g']),
    c: num(nutriments['carbohydrates_100g']),
    f: num(nutriments['fat_100g']),
  };
  let kcal = direct.kcal;
  if (kcal === null) {
    const kj = num(nutriments['energy_100g']);
    if (kj !== null) kcal = kj / KJ_PER_KCAL;
  }
  if (kcal === null && dataPer === 'serving' && servingQuantity !== null && servingQuantity > 0) {
    const perServing = num(nutriments['energy-kcal_serving']);
    if (perServing !== null) {
      const scale = 100 / servingQuantity;
      const p = num(nutriments['proteins_serving']);
      const c = num(nutriments['carbohydrates_serving']);
      const f = num(nutriments['fat_serving']);
      return {
        kcal: clamp(Math.round(perServing * scale), 0, 900),
        p: clamp(Math.round((p ?? 0) * scale * 10) / 10, 0, 100),
        c: clamp(Math.round((c ?? 0) * scale * 10) / 10, 0, 100),
        f: clamp(Math.round((f ?? 0) * scale * 10) / 10, 0, 100),
      };
    }
  }
  if (kcal === null) return null;
  return {
    kcal: clamp(Math.round(kcal), 0, 900),
    p: clamp(direct.p ?? 0, 0, 100),
    c: clamp(direct.c ?? 0, 0, 100),
    f: clamp(direct.f ?? 0, 0, 100),
  };
}

export async function lookupBarcode(
  code: string
): Promise<BarcodeProduct | { error: string }> {
  const trimmed = code.trim();
  if (!isBarcode(trimmed)) return { error: 'That is not a product barcode.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${trimmed}?fields=${OFF_FIELDS}`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) {
      if (res.status === 404) return { error: 'Product not found. Try the AI meal scan instead.' };
      return { error: 'The food database is unreachable. Try again.' };
    }
    const body = (await res.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        brands?: string;
        serving_quantity?: unknown;
        nutrition_data_per?: string;
        nutriments?: OffNutriments;
      };
    };
    if (body.status !== 1 || !body.product)
      return { error: 'Product not found. Try the AI meal scan instead.' };
    const p = body.product;
    const serving = num(p.serving_quantity);
    const per100 = per100From(p.nutriments ?? {}, p.nutrition_data_per, serving);
    if (per100 === null || per100.kcal <= 0)
      return { error: 'No nutrition data on this product. Try the AI meal scan instead.' };
    const name = (p.product_name ?? '').trim() || `Product ${trimmed}`;
    const brand = (p.brands ?? '').split(',')[0]?.trim();
    return {
      item: {
        name: name.slice(0, 60),
        // Default portion: the declared serving, else the label's 100 g.
        grams: clamp(Math.round(serving && serving > 0 ? serving : 100), 1, 2000),
        per100,
        source: 'db',
        matched: `off:${trimmed}`,
      },
      title: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} · ${name}` : name,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return { error: 'The lookup timed out. Try again.' };
    return { error: 'The food database is unreachable. Try again.' };
  } finally {
    clearTimeout(timer);
  }
}
