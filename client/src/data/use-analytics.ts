import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { track, touchActivity } from './analytics';

/**
 * PRODUCT TELEMETRY (migration 080) — session, page-view timing, and time-on-app.
 *
 * MOUNTED ONCE, ABOVE THE `(main)` GROUP (see ui/core/telemetry.tsx). It used to
 * be mounted inside `(main)/_layout.tsx`, which meant it only armed once an
 * athlete had a profile row and had reached the tabs. Everything before that —
 * the whole of `/onboarding` — emitted no `session_start` and no `page_view` at
 * all. Someone who signed up, opened onboarding and never finished was not a
 * short session in the data; they were NOT A SESSION. That is precisely the
 * population behind the 63% who never log a rep, and it was invisible by
 * construction.
 *
 * Emits via the existing `track()` rail (analytics_events) + `touch_activity`.
 * Best-effort and privacy-safe: routes only (dynamic id segments normalised to
 * `:id`), never PII, never blocks a flow.
 *
 * - session_start / session_end (with duration) bracket each app session.
 * - page_view carries the previous route's dwell time on every navigation.
 * - a 60s heartbeat (while foregrounded) keeps last_seen fresh + accrues time.
 */

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Strip user ids from routes so telemetry never records PII in a page path. */
function normalizePage(p: string): string {
  return p
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{3,}/g, '/:id');
}

/**
 * @param userId the authed user, or null while auth is still restoring. Every
 * write here is RLS-gated, so starting before the session lands loses the
 * session_start row AND the last_login_at stamp to a 401 — pass the id and the
 * rail arms only once it exists.
 */
export function useAnalytics(userId: string | null): void {
  const pathname = usePathname();
  const sessionRef = useRef('');
  const sessionStartRef = useRef(0);
  const pageStartRef = useRef(0);
  const prevPageRef = useRef('');

  // Session lifecycle (once per signed-in user).
  useEffect(() => {
    if (!userId) return;
    sessionRef.current = newSessionId();
    sessionStartRef.current = Date.now();
    track('session_start', { session_id: sessionRef.current });
    touchActivity(true, 0);

    /**
     * SESSION LENGTH, NOT TIME SINCE THE LAST BACKGROUNDING.
     *
     * This used to reset `sessionStartRef` after every flush, and flush runs on
     * EVERY visibilitychange. So the second `session_end` of a session reported
     * the gap since the previous backgrounding, the third the gap since that
     * one, and so on — an athlete who tabbed away six times looked like six
     * short sessions instead of one long one. `avg_session_min` on the Insights
     * page was therefore measuring "average time between tab-switches".
     *
     * The start is now written once and never moved, so every row carries the
     * time since the session actually began. Rows for one session_id form a
     * non-decreasing series, and the session's true length is
     * `max(duration_ms) per session_id` — which is what analytics_overview now
     * takes (product migration 133). Averaging the rows themselves would
     * over-weight whoever tabs away most.
     */
    const flush = () => {
      const now = Date.now();
      if (prevPageRef.current) {
        track('page_view', { page: prevPageRef.current, duration_ms: now - pageStartRef.current, session_id: sessionRef.current });
        pageStartRef.current = now; // don't double-count the same dwell on re-flush
      }
      track('session_end', { session_id: sessionRef.current, duration_ms: now - sessionStartRef.current });
    };

    const heartbeat = setInterval(() => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden) return;
      touchActivity(false, 60000);
    }, 60000);

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVis = () => { if (document.hidden) flush(); };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', flush);
      return () => {
        clearInterval(heartbeat);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', flush);
      };
    }
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') flush(); });
    return () => { clearInterval(heartbeat); sub.remove(); };
  }, [userId]);

  // Page-view timing: on each route change, record the PREVIOUS page's dwell.
  useEffect(() => {
    if (!pathname || !userId) return;
    const page = normalizePage(pathname);
    if (prevPageRef.current && prevPageRef.current !== page && sessionRef.current) {
      track('page_view', { page: prevPageRef.current, duration_ms: Date.now() - pageStartRef.current, session_id: sessionRef.current });
    }
    prevPageRef.current = page;
    pageStartRef.current = Date.now();
  }, [pathname, userId]);
}
