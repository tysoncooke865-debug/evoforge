import { labVariantHref } from './links';
import type { LabDataMode } from './types';

/**
 * The in-page variant switcher's PURE half (the registry-meta split, for the
 * same reason: vitest pins the href contract without the RN component graph).
 *
 * The switcher lives on the variant host and replaces the route with a
 * sibling variant of the SAME page. The only params it may touch are its own
 * routing triple — everything else on the URL is a page contract (the
 * workout's date/workout/source ONE-door params) and must ride across the
 * swap unchanged, or flipping a workout variant would land on a workout page
 * with no idea which day it is briefing.
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

/** replace-href to a sibling variant: same page, same data mode, page
 *  contract params forwarded. If the target does not support the mode, the
 *  host's own fallback (requested ∉ modes → defaultMode) absorbs it. */
export function switcherHref(
  pageId: string,
  targetVariant: string,
  mode: LabDataMode,
  params: Record<string, string | string[] | undefined>
): string {
  return labVariantHref(pageId, targetVariant, mode, switcherExtras(params));
}
