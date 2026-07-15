import { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { durations } from '@/theme/animations';
import tokens from '@/theme/tokens';

/**
 * A +XP number that rises from where the action happened and fades. One-shot
 * (always plays; reduced-motion drops the rise and keeps the fade). Parent
 * positions it absolutely over the pressed control and unmounts on done.
 */
export function FloatingXP({
  amount,
  onDone,
  reducedMotion = false,
}: {
  amount: number;
  onDone: () => void;
  reducedMotion?: boolean;
}) {
  const rise = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: durations.micro });
    if (!reducedMotion) {
      rise.value = withTiming(-42, { duration: durations.reward, easing: Easing.out(Easing.quad) });
    }
    opacity.value = withTiming(0, { duration: durations.reward + durations.micro }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 4, top: -6 }, style]}>
      <Text
        style={{
          fontWeight: '900',
          fontSize: 16,
          color: tokens.colors.accent,
          textShadowColor: 'rgba(34,211,238,0.7)',
          textShadowRadius: 10,
        }}
      >
        +{amount} XP
      </Text>
    </Animated.View>
  );
}
