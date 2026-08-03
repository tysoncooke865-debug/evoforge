import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef } from 'react';

import { trackError } from '@/data/analytics';
import { ErrorScreen } from '@/ui/core/error-screen';

/**
 * The shared route error boundary. Re-exported by name from app/_layout.tsx
 * and app/(main)/_layout.tsx — expo-router picks up the `ErrorBoundary`
 * named export per layout and renders it when a route below throws. The
 * (main) copy matters most: it catches errors (including lazy-chunk load
 * failures) WITHOUT unmounting the query/auth/theme providers above it, so
 * RETRY resumes with state intact.
 *
 * IT NOW REPORTS. A route crash was the loudest thing that could happen to an
 * athlete and the quietest thing in the data — this screen rendered and nothing
 * was recorded anywhere. `app_error` with area `route_crash` is the single
 * highest-signal row this app can emit, because unlike a failed write it means
 * the person is looking at a dead end right now.
 *
 * REPORTED IN AN EFFECT, NOT IN RENDER. Emitting during render would fire again
 * on every re-render of the error screen, and a crash loop would then flood
 * analytics_events with the same row — the exact 2026-07-21 retry-flood
 * failure, arriving through a new door. The ref makes it once per mounted
 * error, and `error.message` in the dep array lets a DIFFERENT error after a
 * failed RETRY still be recorded.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const reported = useRef('');
  useEffect(() => {
    const key = error?.message ?? 'unknown';
    if (reported.current === key) return;
    reported.current = key;
    trackError('route_crash', error);
  }, [error]);

  return <ErrorScreen error={error} retry={retry} />;
}
