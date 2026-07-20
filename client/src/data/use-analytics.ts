import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { track, touchActivity } from './analytics';

/**
 * PRODUCT TELEMETRY (migration 080) — session, page-view timing, and time-on-app,
 * mounted ONCE at the authed root. Emits via the existing `track()` rail
 * (analytics_events) + `touch_activity`. Best-effort and privacy-safe: routes
 * only (dynamic id segments normalised to `:id`), never PII, never blocks a flow.
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

export function useAnalytics(): void {
  const pathname = usePathname();
  const sessionRef = useRef('');
  const sessionStartRef = useRef(0);
  const pageStartRef = useRef(0);
  const prevPageRef = useRef('');

  // Session lifecycle (once).
  useEffect(() => {
    sessionRef.current = newSessionId();
    sessionStartRef.current = Date.now();
    track('session_start', { session_id: sessionRef.current });
    touchActivity(true, 0);

    const flush = () => {
      const now = Date.now();
      if (prevPageRef.current) {
        track('page_view', { page: prevPageRef.current, duration_ms: now - pageStartRef.current, session_id: sessionRef.current });
        pageStartRef.current = now; // don't double-count the same dwell on re-flush
      }
      const elapsed = now - sessionStartRef.current;
      track('session_end', { session_id: sessionRef.current, duration_ms: elapsed });
      sessionStartRef.current = now;
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
  }, []);

  // Page-view timing: on each route change, record the PREVIOUS page's dwell.
  useEffect(() => {
    if (!pathname) return;
    const page = normalizePage(pathname);
    if (prevPageRef.current && prevPageRef.current !== page && sessionRef.current) {
      track('page_view', { page: prevPageRef.current, duration_ms: Date.now() - pageStartRef.current, session_id: sessionRef.current });
    }
    prevPageRef.current = page;
    pageStartRef.current = Date.now();
  }, [pathname]);
}
