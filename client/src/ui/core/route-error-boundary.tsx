import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';

import { captureException } from '@/data/monitoring';
import { ErrorScreen } from '@/ui/core/error-screen';

/**
 * The shared route error boundary. Re-exported by name from app/_layout.tsx
 * and app/(main)/_layout.tsx — expo-router picks up the `ErrorBoundary`
 * named export per layout and renders it when a route below throws. The
 * (main) copy matters most: it catches errors (including lazy-chunk load
 * failures) WITHOUT unmounting the query/auth/theme providers above it, so
 * RETRY resumes with state intact.
 *
 * IT ALSO REPORTS (WO-005). This is the highest-value capture point in the
 * app: reaching it means an athlete is looking at SOMETHING BROKE instead of
 * their workout. `captureException` is inert without a DSN, never throws, and
 * the gate in domain/error-report.ts means a screen that throws on every
 * render reports once, not once per frame.
 *
 * data/monitoring.ts is imported here on purpose and keeps its imports to
 * react-native + domain for the same reason error-screen.tsx does: this path
 * must still render while app-layer modules are broken.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, { mechanism: 'route-error-boundary', handled: false });
  }, [error]);

  return <ErrorScreen error={error} retry={retry} />;
}
