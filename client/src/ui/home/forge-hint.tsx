/**
 * HOME (2026-08-03) — the Forge door hint.
 *
 * It used to sit UNDER the champion, where it competed with the podium's own
 * neon and only rendered when the athlete had art. The brief puts it
 * immediately under the masthead and asks for it always visible: it is the
 * one line that teaches the page's central interaction (the champion is a
 * button), and a new athlete has about two seconds to learn it.
 *
 * The breath is the smallest ambient loop in the app — 0.7 to 1.0 opacity
 * over five seconds — and it obeys useAmbient like every other loop, so an
 * unfocused tab, reduced motion or perf mode all hold it still and lit.
 */

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

export function ForgeHint() {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const breath = useSharedValue(1);

  useEffect(() => {
    if (!ambient) {
      breath.value = 1;
      return;
    }
    const ease = Easing.inOut(Easing.quad);
    breath.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 2500, easing: ease }),
        withTiming(1, { duration: 2500, easing: ease })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient]);

  // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson): className
  // interop drops composed styles on Animated.View on web.
  const style = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push('/avatar' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Enter the Forge"
      testID="hero-forge-hint"
      style={{ minHeight: 20, justifyContent: 'center', alignSelf: 'center' }}
    >
      <Animated.View style={style}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            fontSize: 10,
            letterSpacing: 1.6,
            color: colors.accent,
            textShadowColor: 'rgba(34,211,238,0.45)',
            textShadowRadius: 10,
          }}
        >
          ◈ TAP YOUR CHAMPION TO ENTER THE FORGE ›
        </Text>
      </Animated.View>
    </Pressable>
  );
}
