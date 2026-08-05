/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see
   that .value writes are UI-thread animation state, not render state. */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { playPress, playSelect } from '@/ui/core/sound';
import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

type Variant = 'primary' | 'ghost' | 'danger' | 'epic';

/**
 * The one button. Gradient fill (primary), thin neon outline (ghost),
 * press = scale 0.97 + a 1px sink + glow bloom + a light haptic tick on
 * native. Disabled reads quiet, never broken.
 *
 * THE 1PX SINK (2026-08-03) is what the brief calls "press depth": the scale
 * alone read as the button shrinking, and shrink-plus-sink reads as the button
 * being physically pushed into the page. It is a composited transform on a
 * node that already animates, so it costs nothing.
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
  sweep = false,
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
  /** A slow light sweep across the fill — reserved for a screen's single
   *  most important action (Home's START MISSION). It is an AMBIENT LOOP, so
   *  it only renders inside a navigator screen: `ButtonSweep` calls
   *  useAmbient, and useIsFocused throws in a root-level overlay. Never pass
   *  it from something mounted outside the navigator (LevelUpOverlay et al). */
  sweep?: boolean;
}) {
  const colors = useThemeColors();
  const hero = size === 'hero';
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    // The sink is derived from the SAME press value as the scale, so the two
    // can never disagree about whether the button is down.
    transform: [{ scale: scale.value }, { translateY: (1 - scale.value) * 40 }],
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
          minHeight: TOUCH_FLOOR,
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
          minHeight: TOUCH_FLOOR,
          paddingVertical: hero ? 20 : 14,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
          // Clips the sweep to the button's own corners.
          overflow: 'hidden',
        }}
      >
        {sweep && !disabled && !busy ? <ButtonSweep /> : null}
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

/**
 * THE HERO SWEEP — a highlight that crosses the fill once every 4.2 seconds,
 * occupying only the first 30% of the loop so it reads as "the button catches
 * the light" rather than a barber's pole. It exists to make one action on a
 * screen impossible to miss without shouting; if two buttons wear it, neither
 * is dominant and it should be removed from both.
 *
 * Rendered only when `sweep` is set, which is what keeps `useAmbient` legal:
 * an unfocused tab, reduced motion or perf mode all hold it still, and a
 * button outside a navigator never mounts this at all.
 */
function ButtonSweep() {
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.linear }), -1);
  }, [ambient, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value / 0.3;
    if (p > 1) return { opacity: 0, transform: [{ translateX: -140 }] };
    return {
      opacity: Math.sin(p * Math.PI) * 0.85,
      // -140 → +140% of a phone-width button: it enters and fully leaves.
      transform: [{ translateX: -140 + p * 420 }],
    };
  });

  if (!ambient) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 120 }, style]}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

/** The selector chip: quiet at rest, neon-lit when active. Press scales. */
/**
 * THE 44px TOUCH FLOOR, MADE REAL ON WEB (2026-08-05 audit).
 *
 * This app reached for `hitSlop` whenever a control was under the floor, and
 * a comment here said callers should pass it for chips used as primary
 * controls. **On react-native-web 0.21.2 `hitSlop` is honoured only by the
 * legacy `Touchable` module — `Pressable` ignores it entirely** (grep
 * `hitSlop` under `react-native-web/dist`: every hit is in
 * `exports/Touchable/index.js`). Every Pressable in this app therefore had a
 * decorative accessibility fix on the platform that actually ships, the PWA.
 * Falsified in a browser: a click 6px outside a chip does nothing.
 *
 * So the box itself grows. The Pressable is the 44px target and carries the
 * transparent space; the PILL is an inner View that keeps its exact previous
 * padding, radius, border and glow — the chip looks identical and the target
 * is real. `hitSlop` stays because NATIVE Pressable does honour it, and this
 * app is heading for native builds.
 */
const CHIP_TOUCH_FLOOR = 44;
/** Same floor, for the buttons. */
const TOUCH_FLOOR = 44;
/** Vertical only: chip widths already clear 44, and horizontal slop on a row
 *  with an 8px gap would let neighbours fight over the same pixels. */
const CHIP_HIT_SLOP = { top: 8, bottom: 8 } as const;

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
  /** Overrides the default. Chips render ~28px tall, so the DEFAULT already
   *  extends the target vertically to clear the 44px floor — callers only
   *  pass this to widen it further. */
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
        hitSlop={hitSlop ?? CHIP_HIT_SLOP}
        style={{ minHeight: CHIP_TOUCH_FLOOR, justifyContent: 'center' }}
      >
        <View
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
        </View>
      </Pressable>
    </Animated.View>
  );
}
