import { labVariantHref } from './links';

/**
 * The in-page variant switcher's PURE half (the registry-meta split, for the
 * same reason: vitest pins the href contract without the RN component graph).
 *
 * The switcher lives on the variant host and replaces the route with a
 * sibling variant of the SAME page. The only params it may touch are its own
 * routing pair — everything else on the URL is a page contract (the workout's
 * date/workout/source ONE-door params) and must ride across the swap
 * unchanged, or flipping a workout variant would land on a workout page with
 * no idea which day it is briefing.
 *
 * `data` is RETIRED (the lab is mock-only) but stays reserved: a bookmark
 * from the two-mode era carries ?data=mock, and an unreserved `data` would be
 * forwarded as a page-contract extra onto every swap from then on.
 */
export const LAB_RESERVED_PARAMS = ['page', 'variant', 'data'] as const;

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

/** replace-href to a sibling variant: same page, page contract params
 *  forwarded. */
export function switcherHref(
  pageId: string,
  targetVariant: string,
  params: Record<string, string | string[] | undefined>
): string {
  return labVariantHref(pageId, targetVariant, switcherExtras(params));
}
