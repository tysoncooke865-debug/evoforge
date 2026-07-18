import type { ErrorBoundaryProps } from 'expo-router';

import { ErrorScreen } from '@/ui/core/error-screen';

/**
 * The shared route error boundary. Re-exported by name from app/_layout.tsx
 * and app/(main)/_layout.tsx — expo-router picks up the `ErrorBoundary`
 * named export per layout and renders it when a route below throws. The
 * (main) copy matters most: it catches errors (including lazy-chunk load
 * failures) WITHOUT unmounting the query/auth/theme providers above it, so
 * RETRY resumes with state intact.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorScreen error={error} retry={retry} />;
}
