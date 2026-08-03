/**
 * THE SCREEN BACKDROP — drifting fog and rising pixel motes behind a page.
 *
 * Written for Home (2026-08-03, "moving fog, very slow gradient movement,
 * ambient particles, soft drifting energy") and generalised the moment Train
 * asked for the same thing. It lives in ui/core/ so the two screens share ONE
 * implementation and one driver budget rather than diverging into two
 * near-identical files.
 *
 * WHY IT IS A PER-SCREEN OPT-IN AND NOT PART OF ScreenShell. The shell's two
 * ambient glows are drawn on EVERY screen in the app, and the idle tab preload
 * keeps five of them mounted at once — animating them there would run five
 * copies of this on the main JS thread, which is the exact "everything lags"
 * failure the ambient gate exists to prevent. Each screen passes it to
 * `ScreenShell backdrop`, it sits behind the ScrollView (so it never scrolls
 * with the content), and it holds completely still the moment the tab loses
 * focus.
 *
 * ONE DRIVER, 34 SECONDS. Three fog masses drift on a slow Lissajous (their x
 * and y periods are deliberately unequal, so the set never repeats a path an
 * eye could learn) and six pixel motes rise across the whole page. Every
 * position is derived inside a worklet from that single clock.
 *
 * OPACITIES ARE DELIBERATELY UNDER 0.05. This sits behind the athlete's
 * champion, their rating and their mission; the moment it is legible as an
 * object it has failed. It should only ever register as the page not being
 * flat.
 */

import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

const PERIOD = 34000;

/** left% · size · phase · rise fraction of the viewport · sway px. */
const MOTES = [
  { left: '12%', size: 2, phase: 0.0, speed: 0.62, sway: 14 },
  { left: '27%', size: 3, phase: 0.55, speed: 0.48, sway: 20 },
  { left: '44%', size: 2, phase: 0.21, speed: 0.71, sway: 11 },
  { left: '63%', size: 2, phase: 0.78, speed: 0.55, sway: 18 },
  { left: '79%', size: 3, phase: 0.36, speed: 0.66, sway: 13 },
  { left: '91%', size: 2, phase: 0.12, speed: 0.44, sway: 22 },
] as const;

export const ScreenAmbience = memo(function ScreenAmbience() {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: PERIOD, easing: Easing.linear }), -1);
  }, [ambient, t]);

  // The cyan mass, upper left. 1 x-cycle against 2 y-cycles = a figure eight
  // that takes the full 34s to close.
  const fogA = useAnimatedStyle(() => {
    const a = t.value * Math.PI * 2;
    return {
      transform: [
        { translateX: Math.sin(a) * 46 },
        { translateY: Math.cos(a * 2) * 30 },
        { scale: 1 + Math.sin(a * 1.5) * 0.09 },
      ],
    };
  });

  // The purple mass, upper right — counter-rotating, on a 3:2 ratio against
  // the first, so the two never drift in step.
  const fogB = useAnimatedStyle(() => {
    const a = t.value * Math.PI * 2;
    return {
      transform: [
        { translateX: -Math.cos(a * 1.5) * 40 },
        { translateY: Math.sin(a) * 34 },
        { scale: 1 + Math.cos(a) * 0.11 },
      ],
    };
  });

  if (!ambient) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: -180,
            left: -160,
            width: 420,
            height: 420,
            borderRadius: 210,
            backgroundColor: 'rgba(34, 211, 238, 0.045)',
          },
          fogA,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 60,
            right: -200,
            width: 460,
            height: 460,
            borderRadius: 230,
            backgroundColor: 'rgba(168, 85, 247, 0.042)',
          },
          fogB,
        ]}
      />
      {/* A third mass, low and cool, so the fold does not fall off into flat
          black as the athlete scrolls toward the mission. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            bottom: -240,
            left: 20,
            width: 480,
            height: 480,
            borderRadius: 240,
            backgroundColor: 'rgba(34, 211, 238, 0.03)',
          },
          fogA,
        ]}
      />
      {MOTES.map((m, i) => (
        <Mote key={i} {...m} t={t} colour={colors.accent} />
      ))}
    </View>
  );
});

function Mote({
  left,
  size,
  phase,
  speed,
  sway,
  t,
  colour,
}: {
  left: string;
  size: number;
  phase: number;
  speed: number;
  sway: number;
  t: { value: number };
  colour: string;
}) {
  const style = useAnimatedStyle(() => {
    const raw = t.value * speed + phase;
    const p = raw - Math.floor(raw);
    return {
      // The travel is a percentage of the layer, so it works at any height
      // without measuring: bottom drives the rise, transform drives the sway.
      bottom: `${p * 100}%` as `${number}%`,
      transform: [{ translateX: Math.sin(p * Math.PI * 2 + phase * 5) * sway }],
      opacity: (p < 0.12 ? p * 5 : (1 - p) * 0.7) * 0.5,
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: left as `${number}%`,
          // SQUARE: this is a pixel game.
          width: size,
          height: size,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.7,
          shadowRadius: 4,
        },
        style,
      ]}
    />
  );
}
