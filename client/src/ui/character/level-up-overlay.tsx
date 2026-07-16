import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { durations } from '@/theme/animations';
import tokens from '@/theme/tokens';

import { NeonButton } from '@/ui/core/neon-button';
import { playLevelUp } from '@/ui/core/sound';

/**
 * The level-up ceremony: world dims, the number counts old → new, the aura
 * bursts. Only ever triggered from CONFIRMED refetched state (the detector
 * in the main layout), handles multi-level jumps by counting through them.
 * Reduced motion: a static card with the same facts.
 */
export function LevelUpOverlay({
  from,
  to,
  onClose,
}: {
  from: number;
  to: number;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion ? to : from);
  const burst = useSharedValue(0);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    playLevelUp(); // the retro level-up run (web; settings-gated)
    if (reducedMotion) return;
    scale.value = withSequence(
      withTiming(1.08, { duration: durations.panel, easing: Easing.out(Easing.back(1.4)) }),
      withTiming(1, { duration: durations.micro })
    );
    burst.value = withDelay(
      durations.panel,
      withSequence(withTiming(1, { duration: durations.reward }), withTiming(0, { duration: durations.reward }))
    );
    // Count through the levels, ~major-duration total.
    const steps = to - from;
    const perStep = Math.max(120, Math.min(400, durations.major / steps));
    let current = from;
    const timer = setInterval(() => {
      current += 1;
      setShown(current);
      if (current >= to) clearInterval(timer);
    }, perStep);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value * 0.55,
    transform: [{ scale: 1 + burst.value * 0.6 }],
  }));
  const numberStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-s6" style={{ backgroundColor: 'rgba(4,7,14,0.92)' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 340,
              height: 340,
              borderRadius: 170,
              backgroundColor: `${tokens.colors.accent}30`,
              shadowColor: tokens.colors.accent,
              shadowOpacity: 0.8,
              shadowRadius: 60,
            },
            burstStyle,
          ]}
        />
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 4 }}>
          LEVEL UP
        </Text>
        <Animated.View style={numberStyle}>
          <Text
            style={{
              fontSize: 96,
              fontWeight: '900',
              color: tokens.colors.accent,
              textShadowColor: 'rgba(34,211,238,0.8)',
              textShadowRadius: 30,
            }}
          >
            {shown}
          </Text>
        </Animated.View>
        <Text className="mb-s6 text-sm text-text-dim">
          {from} → {to}
        </Text>
        <View className="w-full max-w-[280px]">
          <NeonButton title="KEEP CLIMBING" onPress={onClose} testID="levelup-close" />
        </View>
      </View>
    </Modal>
  );
}
