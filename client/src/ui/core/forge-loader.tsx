/**
 * THE FORGE LOADER (2026-08-04) — the app's one answer to "we are waiting on
 * something," everywhere that wait is long enough or prominent enough to earn
 * more than a bare `ActivityIndicator`.
 *
 * It is the same mark the launch sequence resolves and `ui/boot/boot-hold.tsx`
 * holds still (`ForgeSigil`, a broken ring over nested hexes — never a closed
 * circle, because a closed ring reads as a spinner the instant it turns), with
 * one slow breath so the screen never looks frozen. Landing on this instead of
 * three bespoke loaders for the arena boot, the origin reveal and the roster
 * screen is deliberate: an athlete should recognise "the app is thinking" as
 * ONE unmistakable shape, not relearn it per screen.
 *
 * WHAT IT IS NOT FOR. A button's own busy state (SAVE, EXPORT, LOG) stays a
 * plain `ActivityIndicator` sized to the button — this mark is for a SECTION
 * or a SCREEN waiting on something, not a control waiting on its own tap.
 * Putting a full sigil inside a 44pt button would be the tail-wagging-the-dog
 * version of the same over-reach the doctrine warns about everywhere else.
 *
 * `useAmbient()`, not `useReducedMotion()` directly: every real caller renders
 * inside a navigator screen (a route, or a component mounted from one), so the
 * full gate — focus + reduced motion + perf mode — applies, exactly like every
 * other ambient loop in the app. `boot-hold.tsx` is the one exception (it sits
 * ABOVE the navigator, where `useIsFocused` throws), which is why it keeps its
 * own copy of this breathing animation rather than using this component.
 */

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';
import { ForgeSigil } from '@/ui/boot/forge-sigil';

export function ForgeLoader({
  label,
  size = 56,
  tint,
  halo,
  fill = false,
  testID = 'forge-loader',
}: {
  /** What the app is doing — always visible, never a bare mark alone. */
  label: string;
  size?: number;
  /** Defaults to the app's own accent; pass a package's own token (e.g. the
   *  Arena's `colors.cyan`) where a screen keeps its own palette. */
  tint?: string;
  halo?: string;
  /** Centres inside a `flex: 1` container filling its parent — a whole-screen
   *  wait rather than a boxed section. */
  fill?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [ambient, t]);

  const breath = useAnimatedStyle(() => ({
    opacity: 0.4 + t.value * 0.35,
    transform: [{ scale: 0.97 + t.value * 0.05 }],
  }));

  return (
    <View
      style={[{ alignItems: 'center', justifyContent: 'center', gap: 12 }, fill ? { flex: 1 } : null]}
      testID={testID}
    >
      <Animated.View style={breath}>
        <ForgeSigil size={size} colour={tint ?? colors.accent} halo={halo ?? colors['accent-deep']} intensity={0.8} />
      </Animated.View>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{
          fontFamily: PIXEL_BOLD,
          fontSize: 10,
          letterSpacing: 2.4,
          color: colors['text-mute'],
        }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
