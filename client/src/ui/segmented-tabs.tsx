/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press/layout handlers by design, same as neon-button. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import tokens from '@/theme/tokens';

/** The segmented capsule: two tabs, a sprung slider, cyan-lit active side. */
export function SegmentedTabs({
  left,
  right,
  active,
  onChange,
  testIDPrefix = 'arena-tab',
}: {
  left: string;
  right: string;
  active: 0 | 1;
  onChange: (index: 0 | 1) => void;
  testIDPrefix?: string;
}) {
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
      style={{ borderWidth: 1, borderColor: `${tokens.colors.epic}33`, backgroundColor: 'rgba(13,21,36,0.6)' }}
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
            borderColor: `${tokens.colors.accent}8c`,
            shadowColor: tokens.colors.accent,
            shadowOpacity: 0.4,
            shadowRadius: 12,
          },
          slider,
        ]}
      />
      {[left, right].map((label, i) => (
        <Pressable
          key={label}
          onPress={() => select(i as 0 | 1)}
          accessibilityRole="button"
          className="min-h-[44px] flex-1 items-center justify-center rounded-pill"
          testID={`${testIDPrefix}-${i}`}
        >
          <Text
            className="text-xs font-bold"
            style={{ letterSpacing: 1.5, color: active === i ? tokens.colors.accent : tokens.colors['text-dim'] }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
