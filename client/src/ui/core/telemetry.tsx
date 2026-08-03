import { useAuth } from '@/data/auth-context';
import { useAnalytics } from '@/data/use-analytics';

/**
 * The product-telemetry rail, mounted once for the WHOLE app.
 *
 * WHY IT IS A COMPONENT AND NOT A HOOK CALL IN RootLayout. `useAnalytics` needs
 * the session, and `useAuth` only works below `<AuthProvider>` — which
 * RootLayout renders. A component lets the hook run inside the provider it
 * depends on without splitting the root layout in two.
 *
 * WHY IT IS ABOVE `(main)` AND NOT INSIDE IT. Mounted in `(main)/_layout.tsx`
 * the rail only armed once an athlete had a profile row, so `/onboarding` — the
 * screen the 63% who never log a rep are lost on — produced no `session_start`
 * and no `page_view` whatsoever. Not short sessions: no sessions.
 *
 * IT RENDERS NOTHING and it never suspends. Telemetry must not be able to
 * change what is on screen; if this component could throw or block, an
 * analytics failure would become a boot failure.
 *
 * A SIGNED-OUT VISITOR STILL EMITS NOTHING, deliberately. `analytics_events` is
 * owner-insert RLS, so a write with no `auth.uid()` is rejected by the server
 * anyway; `useAnalytics(null)` returns early rather than firing writes that
 * cannot land. The sign-in screens stay dark on purpose — the gap this closes
 * is the authed-but-not-yet-onboarded one.
 */
export function Telemetry() {
  const { session } = useAuth();
  useAnalytics(session?.user?.id ?? null);
  return null;
}
