/**
 * ANALYTICS — the repo's FIRST shared emitter (docs/ORIGIN_ANALYTICS.md).
 *
 * Rail: analytics_events (migration 029, owner-insert RLS, event_name 3-60
 * chars + props jsonb). Delivery is client-side best-effort: an event can
 * be LOST (offline, killed app) but is emitted at most once per triggering
 * interaction. The events that must be trustworthy-exactly-once for product
 * accounting (origin_binding_completed, free_reforge_completed) are also
 * derivable server-side from evo_assessments / user_path_migration_log.
 *
 * RULES (pinned by vitest):
 * - fire-and-forget: never awaited by callers, never gates navigation,
 *   binding, or ceremony timing; a rejected insert is swallowed.
 * - privacy: no photos, photo hashes, raw measurements, lift numbers,
 *   display names. Ratings are bucketed, errors are category strings.
 */

import { supabase } from './supabase';

/** A rating value into a decade bucket ("40s") — never the exact value. */
export function ratingBand(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const decade = Math.max(0, Math.min(9, Math.floor(rating / 10)));
  return `${decade}0s`;
}

export function track(eventName: string, props: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      await supabase.from('analytics_events').insert({ event_name: eventName, props });
    } catch {
      /* best-effort by design — analytics must never break a flow */
    }
  })();
}
