import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playPowerUp, playSelect } from '@/ui/core/sound';

/**
 * HOLD TO CONFIRM — for the one action that must never happen by accident.
 *
 * An all-in is the whole wallet. A single tap can be a misfire, a double-tap
 * on a slow screen, or a thumb landing on a button that moved under it. A hold
 * cannot be any of those: it takes a second of deliberate contact, it shows
 * exactly how far through that second you are, and letting go cancels it with
 * nothing said.
 *
 * REDUCED MOTION DOES NOT SHORTEN IT. The fill is a progress indicator, not
 * decoration — removing it would leave a button that fires after an
 * unexplained delay, which is worse than the animation it was avoiding.
 */
export function HoldToConfirm({
  label,
  holdingLabel = 'KEEP HOLDING…',
  onConfirm,
  durationMs = 1100,
  tone,
  disabled = false,
  testID,
}: {
  label: string;
  holdingLabel?: string;
  onConfirm: () => void;
  durationMs?: number;
  tone?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const accent = tone ?? colors.danger;
  const progress = useSharedValue(0);
  const [holding, setHolding] = useState(false);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const fire = useCallback(() => {
    setHolding(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    playPowerUp();
    onConfirm();
  }, [onConfirm]);

  const start = () => {
    if (disabled) return;
    setHolding(true);
    playSelect();
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.value = 0;
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
  };

  const cancel = () => {
    setHolding(false);
    progress.value = withTiming(0, { duration: 180 });
  };

  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Press and hold to confirm.`}
      accessibilityState={{ disabled }}
      testID={testID}
      className="w-full overflow-hidden rounded-xl border"
      style={{
        minHeight: 56,
        justifyContent: 'center',
        borderColor: `${accent}8c`,
        backgroundColor: 'rgba(251,113,133,0.08)',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: `${accent}33` },
          fill,
        ]}
      />
      <View className="items-center">
        <Text
          allowFontScaling={false}
          style={{ fontSize: 15, letterSpacing: 1, color: accent, ...pixelFont() }}
        >
          {holding ? holdingLabel : label}
        </Text>
      </View>
    </Pressable>
  );
}
