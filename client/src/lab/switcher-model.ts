import { labVariantHref } from './links';

/**
 * The in-page variant switcher's PURE half (the registry-meta split, for the
 * same reason: vitest pins the href contract without the RN component graph).
 *
 * The switcher lives on the variant host and replaces the route with a
 * sibling variant of the SAME page. The only params it may touch are its own
 * routing set — everything else on the URL is a page contract (the workout's
 * date/workout/source ONE-door params) and must ride across the swap
 * unchanged, or flipping a workout variant would land on a workout page with
 * no idea which day it is briefing.
 *
 * `data` is RETIRED (the lab is mock-only) but stays reserved: a bookmark
 * from the two-mode era carries ?data=mock, and an unreserved `data` would be
 * forwarded as a page-contract extra onto every swap from then on.
 *
 * `batch` (2026-09-04) is the strip's SCOPE: which batch's takes share the
 * bar with CURRENT. It is reserved for the same reason `data` is — it names
 * lab routing state, not page state — and re-appended explicitly by
 * switcherHref so it survives every swap inside a batch, including the hop
 * onto CURRENT and back.
 */
export const LAB_RESERVED_PARAMS = ['page', 'variant', 'data', 'batch'] as const;

/** Forwardable extras from a useLocalSearchParams record: reserved routing
 *  params stripped, array values collapsed to their first entry (expo-router
 *  hands back arrays for repeated params; the lab never repeats one). */
export function switcherExtras(
  params: Record<string, string | string[] | undefined>
): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const [key, raw] of Object.entries(params)) {
    if ((LAB_RESERVED_PARAMS as readonly string[]).includes(key)) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) continue;
    extras[key] = value;
  }
  return extras;
}

/** replace-href to a sibling variant: same page, page-contract params
 *  forwarded, batch scope re-applied when the strip has one. */
export function switcherHref(
  pageId: string,
  targetVariant: string,
  params: Record<string, string | string[] | undefined>,
  batchNumber?: number
): string {
  const extras = switcherExtras(params);
  if (batchNumber !== undefined) extras.batch = String(batchNumber);
  return labVariantHref(pageId, targetVariant, extras);
}

/** The structural slice of LabPage this module needs — kept structural so
 *  the pure half never imports the component-carrying types. */
interface BatchesShape {
  batches: readonly { number: number; variants: readonly { id: string }[] }[];
}

/**
 * Which batch is this URL inside? TOTAL — it reads a raw query param during
 * the host's render, so garbage answers null, never throws.
 *
 * Membership wins: a codename variant belongs to exactly one batch (the
 * registry pins codename uniqueness), so its owning batch scopes the strip
 * regardless of what the URL claims. `baseline` belongs to none, so viewing
 * CURRENT trusts a valid ?batch — that is how the CURRENT tab stays inside
 * the batch being compared. A stale or unknown ?batch (the batch was
 * deleted; a hand-typed URL) resolves null, and the strip degrades to
 * [← LAB | CURRENT].
 */
export function resolveBatchNumber(
  page: BatchesShape,
  variantId: string | undefined,
  rawBatchParam: string | string[] | undefined
): number | null {
  const owner = page.batches.find((b) => b.variants.some((v) => v.id === variantId));
  if (owner) return owner.number;
  const raw = Array.isArray(rawBatchParam) ? rawBatchParam[0] : rawBatchParam;
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return page.batches.some((b) => b.number === n) ? n : null;
}
