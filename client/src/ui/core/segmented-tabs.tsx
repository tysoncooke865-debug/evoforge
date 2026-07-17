/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press/layout handlers by design, same as neon-button. */
import { useState, type ReactNode } from 'react';
import { playSelect } from '@/ui/core/sound';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/** The segmented capsule: two tabs, a sprung slider, cyan-lit active side.
 *  TRAIN_OVERHAUL: optional icons before each label (Train's pixel dumbbell /
 *  heart) — arena call sites pass none and render exactly as before. */
export function SegmentedTabs({
  left,
  right,
  active,
  onChange,
  testIDPrefix = 'arena-tab',
  leftIcon,
  rightIcon,
  pixelLabels = false,
}: {
  left: string;
  right: string;
  active: 0 | 1;
  onChange: (index: 0 | 1) => void;
  testIDPrefix?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Train's 16-bit labels. */
  pixelLabels?: boolean;
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const slider = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const select = (index: 0 | 1) => {
    // Spring tune (PHASE_2_PLAN commit 1, owner-decided): ζ = damping /
    // (2·√(stiffness·mass)) = 32 / (2·√320) ≈ 0.89 vs the old 20/(2·√260)
    // ≈ 0.62 — one barely-visible ~2% overshoot instead of a multi-cycle
    // wobble, and the higher stiffness keeps the attack sharp.
    x.value = withSpring((index * width) / 2, { damping: 32, stiffness: 320 });
    onChange(index);
  };

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width - 8; // inset padding
        setWidth(w);
        x.value = (active * w) / 2;
      }}
      className="flex-row rounded-pill p-s1"
      style={{ borderWidth: 1, borderColor: `${colors.epic}33`, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 4,
            left: 4,
            bottom: 4,
            width: width / 2,
            borderRadius: 999,
            backgroundColor: 'rgba(34,211,238,0.14)',
            borderWidth: 1,
            borderColor: `${colors.accent}8c`,
            shadowColor: colors.accent,
            shadowOpacity: 0.4,
            shadowRadius: 12,
          },
          slider,
        ]}
      />
      {[left, right].map((label, i) => {
        const icon = i === 0 ? leftIcon : rightIcon;
        return (
          <Pressable
            key={label}
            onPress={() => {
              playSelect(); // the retro tick (web; settings-gated)
              select(i as 0 | 1);
            }}
            accessibilityRole="button"
            className="min-h-[44px] flex-1 flex-row items-center justify-center gap-s2 rounded-pill"
            testID={`${testIDPrefix}-${i}`}
          >
            {icon}
            <Text
              className="text-xs font-bold"
              allowFontScaling={!pixelLabels}
              style={{
                letterSpacing: pixelLabels ? 0.5 : 1.5,
                fontFamily: pixelLabels ? PIXEL_BOLD : undefined,
                fontWeight: pixelLabels ? 'normal' : undefined,
                color: active === i ? colors.accent : colors['text-dim'],
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
