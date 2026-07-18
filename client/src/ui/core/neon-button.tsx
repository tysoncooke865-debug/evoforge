/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see
   that .value writes are UI-thread animation state, not render state. */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { playPress, playSelect } from '@/ui/core/sound';
import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

type Variant = 'primary' | 'ghost' | 'danger' | 'epic';

/**
 * The one button. Gradient fill (primary), thin neon outline (ghost),
 * press = scale 0.97 + glow bloom + a light haptic tick on native.
 * Disabled reads quiet, never broken.
 */
export function NeonButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  icon,
  rightIcon,
  pixel = true,
  testID,
  size = 'base',
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  /** Trailing affordance — the Train hero's chevron. */
  rightIcon?: ReactNode;
  /** Pixel display labels (Jersey 25) — the DEFAULT since the app-wide
   *  design pass; pass false to opt a label back onto the system face.
   *  Real bold face — never a synthesized bold, it smears pixel glyphs. */
  pixel?: boolean;
  testID?: string;
  /** TRAIN_OVERHAUL `hero`: the page's ONE dominant action — taller, bigger
   *  label, stronger glow. Everything else keeps `base`. */
  size?: 'base' | 'hero';
}) {
  const colors = useThemeColors();
  const hero = size === 'hero';
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOpacity: 0.2 + glow.value * 0.45,
  }));

  const press = () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    playPress(); // the retro confirm blip (web; settings-gated)
    onPress();
  };

  const palette = {
    primary: { shadow: colors.accent, text: colors['accent-ink'] },
    ghost: { shadow: colors.accent, text: colors.accent },
    danger: { shadow: colors.danger, text: colors['accent-ink'] },
    // FUEL_REDESIGN: the AI/reward accent — purple fill, light label (the
    // epic gradient runs darker than the cyan one; accent-ink would vanish).
    epic: { shadow: colors.epic, text: '#f8f4ff' },
  }[variant];

  const inner =
    variant === 'ghost' ? (
      <View
        style={{
          borderWidth: 1,
          borderColor: disabled ? colors.border : `${colors.accent}8c`,
          borderRadius: 12,
          paddingVertical: hero ? 20 : 14,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: 'rgba(34, 211, 238, 0.06)',
        }}
      >
        {icon}
        <Text
          allowFontScaling={!pixel}
          style={{
            fontWeight: pixel ? 'normal' : '800',
            fontFamily: pixel ? PIXEL_BOLD : undefined,
            letterSpacing: pixel ? 0.5 : 1,
            fontSize: pixel ? (hero ? 16 : 13) : hero ? 18 : undefined,
            color: disabled ? colors['text-mute'] : palette.text,
          }}
        >
          {title}
        </Text>
        {rightIcon}
      </View>
    ) : (
      <LinearGradient
        colors={
          disabled
            ? [colors['surface-2'], colors['surface-2']]
            : variant === 'danger'
              ? [colors.danger, '#e11d48']
              : variant === 'epic'
                ? // Darker ramp than raw epic: every stop clears WCAG 4.5:1
                  // against the light label (epic #a855f7 itself sits at 3.6).
                  ['#9333ea', '#7e22ce', '#6b21a8']
                : [colors['accent-strong'], colors.accent, colors['accent-deep']]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 12,
          paddingVertical: hero ? 20 : 14,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {busy ? <ActivityIndicator color={palette.text} /> : icon}
        {!busy ? (
          <Text
            allowFontScaling={!pixel}
            style={{
              fontWeight: pixel ? 'normal' : '800',
              fontFamily: pixel ? PIXEL_BOLD : undefined,
              letterSpacing: pixel ? 0.5 : 1,
              fontSize: pixel ? (hero ? 16 : 13) : hero ? 18 : undefined,
              color: disabled ? colors['text-mute'] : palette.text,
            }}
          >
            {title}
          </Text>
        ) : null}
        {!busy ? rightIcon : null}
      </LinearGradient>
    );

  return (
    <Animated.View
      style={[
        {
          shadowColor: palette.shadow,
          shadowRadius: hero ? 26 : 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: hero ? 10 : 8,
        },
        animatedStyle,
      ]}
    >
      <Pressable
        onPress={press}
        disabled={disabled || busy}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 20, stiffness: 400 });
          glow.value = withTiming(1, { duration: 120 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 300 });
          glow.value = withTiming(0, { duration: 260 });
        }}
        testID={testID}
      >
        {inner}
      </Pressable>
    </Animated.View>
  );
}

/** The selector chip: quiet at rest, neon-lit when active. Press scales. */
export function Chip({
  label,
  active,
  onPress,
  testID,
  hitSlop,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  /** Chips render ~28px tall; rows using them as primary controls extend
   *  the target to the 44px floor without changing the visual. */
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
}) {
  const colors = useThemeColors();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          playSelect(); // the retro tick (web; settings-gated)
          onPress();
        }}
        onPressIn={() => (scale.value = withSpring(0.95, { damping: 20, stiffness: 400 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 16, stiffness: 300 }))}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        hitSlop={hitSlop}
        style={{
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderColor: active ? `${colors.accent}8c` : colors.border,
          backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : colors['surface-2'],
          shadowColor: colors.accent,
          shadowOpacity: active ? 0.35 : 0,
          shadowRadius: 10,
          elevation: active ? 4 : 0,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: active ? colors.accent : colors['text-dim'],
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
