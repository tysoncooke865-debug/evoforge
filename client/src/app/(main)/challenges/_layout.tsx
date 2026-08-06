import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme';

/** The Challenges stack inside the tab: hub → new → [id]. */
export default function ChallengesLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors['bg-deep'] },
      }}
    />
  );
}
