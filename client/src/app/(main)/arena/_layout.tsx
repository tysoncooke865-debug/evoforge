import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme';

/** The Arena's own stack inside the tab: hub → battle/[id]. */
export default function ArenaLayout() {
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
