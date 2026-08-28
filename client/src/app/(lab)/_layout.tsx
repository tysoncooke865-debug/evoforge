import { Stack } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * PAGE LAB — the dev-only variant gallery (src/lab/README.md).
 *
 * INACCESSIBLE IN PRODUCTION: same doctrine as muscle-lab.tsx — the lab is
 * compiled out unless the build is __DEV__ or EXPO_PUBLIC_PAGE_LAB=1 was
 * inlined at export time. Only the `lab` branch's CI build sets the flag
 * (client.yml). Gating the LAYOUT covers every child route at once.
 *
 * It SAYS SO rather than rendering blank (2026-08-28, muscle-lab's rule): a
 * dead-looking screen teaches whoever followed the link that the app is
 * broken, and /lab is a URL that gets pasted around.
 *
 * A Stack OUTSIDE (main), on purpose:
 *  - no tab bar under variants — a workout variant renders as the pushed
 *    full-screen page it is;
 *  - no (main) auth redirect — mock mode must work signed out;
 *  - back is a real stack pop, not the pops-the-previous-TAB trap
 *    (HANDOVER §3).
 */
const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_PAGE_LAB === '1';

// HYDRATION GATE: false at static-export time and during the hydration pass,
// true from the first client re-render — so every lab page pre-renders blank
// and hydration has nothing to mismatch (GlowCard's gradient angle is
// layout-dependent and tripped React #418 when the gallery hydrated real
// markup). useSyncExternalStore, not setState-in-effect — the compiler lint
// forbids the latter. A one-frame blank is a fair price for a clean console.
const emptySubscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

export default function LabLayout() {
  const colors = useThemeColors();
  const hydrated = useHydrated();
  // The hydration gate comes FIRST: the unavailable copy is real markup, and
  // pre-rendering it would hand hydration something to mismatch.
  if (!hydrated) return null;
  if (!ENABLED) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="DEV TOOLS" title="PAGE LAB" />
        <Text className="text-sm text-text-dim">
          The page lab is a development tool and is not part of this build.
        </Text>
      </ScreenShell>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
