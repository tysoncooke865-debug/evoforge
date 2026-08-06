import { Redirect, Stack } from 'expo-router';

import { useIsAdmin } from '@/data/analytics-admin';
import { useThemeColors } from '@/theme/use-theme';
import { challengeFeatures } from '@/ui/challenges/features';

/**
 * The Challenges stack inside the tab: hub → new → [id].
 *
 * IT ALSO GUARDS THE ROUTE, not just the tab. Hiding the tab bar entry is a
 * navigation change; the URL still resolved, so anyone who typed /challenges
 * could stake REAL COINS before the founders had tested the settlement that
 * pays them out. A feature flag that only hides a button is not a flag.
 *
 * Admins see it regardless of the flag, which is how the manual pass happens
 * on a real phone against real data without turning a live wager system on
 * for everybody. While the admin check is in flight we render nothing rather
 * than redirecting — bouncing someone off their own page because a query had
 * not answered yet is worse than a blank frame.
 */
export default function ChallengesLayout() {
  const colors = useThemeColors();
  const admin = useIsAdmin();

  if (!challengeFeatures.challengesEnabled) {
    if (admin.isPending) return null;
    if (admin.data !== true) return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors['bg-deep'] },
      }}
    />
  );
}
