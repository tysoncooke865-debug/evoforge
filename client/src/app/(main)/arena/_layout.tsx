import { Stack } from 'expo-router';

import tokens from '@/theme/tokens';

/** The Arena's own stack inside the tab: hub → battle/[id]. */
export default function ArenaLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.colors['bg-deep'] },
      }}
    />
  );
}
