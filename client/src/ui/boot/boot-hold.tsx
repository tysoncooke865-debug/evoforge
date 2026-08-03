/**
 * THE HOLD — what the signed-in shell shows while the session restores and the
 * profile arrives.
 *
 * It replaces a bare `ActivityIndicator` on a flat background, which was the
 * app's entire "loading experience" and read like a form submitting. This is
 * the same forge sigil the launch sequence resolves, held still, with one slow
 * breath so the screen is not frozen.
 *
 * IT IS RARELY SEEN, AND THAT IS THE POINT. The launch overlay covers the first
 * ~2.7 seconds, which is longer than a warm session restore takes, so this only
 * appears on a genuinely slow network — and when it does it should look like
 * the same app, not like a different one having a problem.
 *
 * The breath is an AMBIENT LOOP but it cannot use `useAmbient()`: this renders
 * inside the (main) layout ABOVE the navigator's screens, and `useIsFocused`
 * throws outside a screen. It consults `useReducedMotion` directly instead,
 * which is what the motion guard requires.
 */

import { useEffect } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { ForgeSigil } from './forge-sigil';

export function BootHold() {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [reduced, t]);

  const breath = useAnimatedStyle(() => ({
    opacity: 0.4 + t.value * 0.35,
    transform: [{ scale: 0.97 + t.value * 0.05 }],
  }));

  const size = Math.min(width * 0.62, height * 0.36, 240);

  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: colors['bg-deep'] }}
      testID="boot-hold"
    >
      <Animated.View style={breath}>
        <ForgeSigil size={size} colour={colors.accent} halo={colors['accent-deep']} intensity={0.8} />
      </Animated.View>
      <Text
        allowFontScaling={false}
        style={{
          marginTop: 18,
          fontFamily: PIXEL_BOLD,
          fontSize: 11,
          letterSpacing: 3,
          color: colors['text-mute'],
        }}
      >
        STOKING THE FORGE
      </Text>
    </View>
  );
}
