/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see
   that .value writes are UI-thread animation state, not render state. */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { PIXEL_BOLD } from '@/theme/fonts';
import tokens from '@/theme/tokens';

type Variant = 'primary' | 'ghost' | 'danger';

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
  pixel = false,
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
  /** Train's pixel display labels (Pixelify Sans). Real bold face — never a
   *  synthesized bold, it smears pixel glyphs. */
  pixel?: boolean;
  testID?: string;
  /** TRAIN_OVERHAUL `hero`: the page's ONE dominant action — taller, bigger
   *  label, stronger glow. Everything else keeps `base`. */
  size?: 'base' | 'hero';
}) {
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
    onPress();
  };

  const palette = {
    primary: { shadow: tokens.colors.accent, text: tokens.colors['accent-ink'] },
    ghost: { shadow: tokens.colors.accent, text: tokens.colors.accent },
    danger: { shadow: tokens.colors.danger, text: tokens.colors['accent-ink'] },
  }[variant];

  const inner =
    variant === 'ghost' ? (
      <View
        style={{
          borderWidth: 1,
          borderColor: disabled ? tokens.colors.border : `${tokens.colors.accent}8c`,
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
            color: disabled ? tokens.colors['text-mute'] : palette.text,
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
            ? [tokens.colors['surface-2'], tokens.colors['surface-2']]
            : variant === 'danger'
              ? [tokens.colors.danger, '#e11d48']
              : [tokens.colors['accent-strong'], tokens.colors.accent, tokens.colors['accent-deep']]
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
              color: disabled ? tokens.colors['text-mute'] : palette.text,
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
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          onPress();
        }}
        onPressIn={() => (scale.value = withSpring(0.95, { damping: 20, stiffness: 400 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 16, stiffness: 300 }))}
        testID={testID}
        style={{
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderColor: active ? `${tokens.colors.accent}8c` : tokens.colors.border,
          backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : tokens.colors['surface-2'],
          shadowColor: tokens.colors.accent,
          shadowOpacity: active ? 0.35 : 0,
          shadowRadius: 10,
          elevation: active ? 4 : 0,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: active ? tokens.colors.accent : tokens.colors['text-dim'],
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
