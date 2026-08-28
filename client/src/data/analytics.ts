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

/**
 * THE PAGE LAB EMITS NOTHING (2026-08-28).
 *
 * Every lab variant renders REAL shared components, and a shared component is
 * not allowed to be forked just to silence it (src/lab/README.md). So the one
 * honest place to stop lab telemetry is the emitter itself.
 *
 * Without this, opening a Home variant inserts analytics_events rows under
 * whatever session sits beneath the lab's fake one — polluting the very funnel
 * the events exist to measure with the activity of a developer comparing
 * designs. `useLabActivationStep` already made this argument for the
 * activation rail; this closes the rest of it, including ForgeCacheCard's
 * mount-time `daily_checkin_viewed`.
 *
 * Both tests, because both are needed: the FLAG covers the whole lab deploy
 * (whose root redirects to /lab, so a pathname test alone is false at mount —
 * the boot-gate lesson), and the PATH covers /lab in a dev build, which
 * carries no flag. Metro inlines the flag, so on a production build this
 * collapses to the path test.
 */
function inPageLab(): boolean {
  if (process.env.EXPO_PUBLIC_PAGE_LAB === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.location.pathname.startsWith('/lab');
  } catch {
    return false;
  }
}

/** A rating value into a decade bucket ("40s") — never the exact value. */
export function ratingBand(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const decade = Math.max(0, Math.min(9, Math.floor(rating / 10)));
  return `${decade}0s`;
}

export function track(eventName: string, props: Record<string, unknown> = {}): void {
  if (inPageLab()) return;
  void (async () => {
    try {
      await supabase.from('analytics_events').insert({ event_name: eventName, props });
    } catch {
      /* best-effort by design — analytics must never break a flow */
    }
  })();
}

/**
 * The one event name for "something broke in front of an athlete".
 *
 * WHY IT EXISTS. Failures were visible to the person and to nobody else: the
 * XP-grant failure in mutations.ts raised a toast and stopped there, so a
 * ledger falling behind for every athlete on a bad deploy looked, in the data,
 * exactly like a good day. There is no crash reporter in this build (Sentry is
 * deferred to native — HANDOVER §7), and "we will notice" is not monitoring.
 *
 * `area` IS THE PRIMARY KEY OF THE ALERT, not the message. It is a short stable
 * slug chosen at the call site ('xp_grant', 'route_crash'), so the same failure
 * groups across builds even when its wording changes. Free-text messages are
 * what make an error dashboard unqueryable.
 *
 * PRIVACY, per this file's contract: the reason is a CATEGORY-ISH STRING, never
 * a payload. It is truncated hard, and anything shaped like a uuid or an email
 * is redacted before it leaves the device — error text is the classic accidental
 * carrier of both (a failed insert loves to quote the row it refused).
 */
export function errorReason(e: unknown): string {
  const raw =
    e instanceof Error ? e.message
    : typeof e === 'string' ? e
    : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
    : 'unknown';
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ':email')
    .slice(0, 160);
}

export function trackError(area: string, e: unknown, extra: Record<string, unknown> = {}): void {
  track('app_error', { area, reason: errorReason(e), ...extra });
}

/**
 * Update the caller's activity summary (migration 080): `login` marks a fresh
 * session (bumps sessions + last_login); `ms` accrues time-on-app; every call
 * refreshes last_seen. Fire-and-forget, same contract as track().
 */
export function touchActivity(login: boolean, ms = 0): void {
  if (inPageLab()) return; // same rule as track(): the lab is not a session
  void (async () => {
    try {
      await supabase.rpc('touch_activity', { p_login: login, p_ms: Math.max(0, Math.round(ms)) });
    } catch {
      /* best-effort */
    }
  })();
}
