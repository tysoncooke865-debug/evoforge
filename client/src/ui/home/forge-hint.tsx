/**
 * HOME — THE FORGE DOOR, in two parts.
 *
 * `ForgeHint` sits directly under the masthead, ABOVE the Evo Rating. Tyson
 * (2026-08-03, third brief): "it teaches interaction before the user sees the
 * Champion." It moved to the podium for one revision and moved back — the
 * argument for the top is stronger than the argument against, because an
 * athlete who has not yet learned the champion is a button never scrolls far
 * enough to find out.
 *
 * `ForgeNameplate` is the plate across the podium's front face, and it is now
 * a STATE, not an instruction: it carries the champion's form name and nothing
 * else. "Tap to enter the Forge" left it, because the hint above already says
 * that and a plaque that repeats it is a label arguing with itself. THE GRIND
 * is who the champion is right now.
 *
 * MOTION (the hint only, one driver): the whole line breathes between 0.9 and
 * 1.0 opacity — a wider swing reads as a fault rather than a pulse — and the
 * chevron nudges right once per cycle, which is the part the eye actually
 * reads as "this goes somewhere". Both derive from one 4.4s clock, and it
 * rides `useAmbient` like every other loop: an unfocused tab, reduced motion
 * or perf mode all hold it still and fully lit.
 *
 * The plate is deliberately STILL. The deck below it already carries a
 * rotating ring, a light sweep and three chasing LEDs; a breathing label on
 * top of that is the "busy" the brief bans. Prestige is stillness next to
 * motion.
 */

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

export function ForgeHint() {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 4400, easing: Easing.linear }), -1);
  }, [ambient, t]);

  // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson): className
  // interop drops composed styles on Animated.View on web.
  const breath = useAnimatedStyle(() => ({
    opacity: 0.9 + 0.1 * ((1 + Math.cos(t.value * Math.PI * 2)) / 2),
  }));

  // The nudge occupies the last 18% of the cycle — a beat of movement, then
  // ~3.6s of stillness, so it reads as an invitation rather than a twitch.
  const chevron = useAnimatedStyle(() => {
    const p = (t.value - 0.82) / 0.18;
    if (p < 0) return { transform: [{ translateX: 0 }] };
    return { transform: [{ translateX: Math.sin(p * Math.PI) * 3 }] };
  });

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        playSelect();
        router.push('/avatar' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Enter the Forge"
      testID="hero-forge-hint"
      style={{ minHeight: 20, justifyContent: 'center', alignSelf: 'center' }}
    >
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center' }, breath]}>
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
          ◈ TAP YOUR CHAMPION TO ENTER THE FORGE
        </Text>
        <Animated.View style={chevron}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.6, color: colors.accent, paddingLeft: 4 }}
          >
            ›
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** The champion's current STATE, engraved on the podium. No instruction. */
export function ForgeNameplate({ formName }: { formName: string }) {
  const colors = useThemeColors();
  return (
    <View
      pointerEvents="none"
      testID="hero-form"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}
    >
      <View
        className="items-center rounded-md border px-s3 py-s1"
        style={{
          maxWidth: '86%',
          borderColor: `${colors.accent}3d`,
          // Darker than the surrounding fog so the plate reads as machined
          // metal set INTO the podium, not a chip floating over it.
          backgroundColor: 'rgba(4,7,14,0.72)',
        }}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          allowFontScaling={false}
          style={{ fontSize: 13, letterSpacing: 1.2, color: colors.accent, ...pixelFont() }}
        >
          {formName.toUpperCase()}
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 7, letterSpacing: 1.4, color: colors['text-mute'], ...pixelFont(false) }}
        >
          CURRENT FORM
        </Text>
      </View>
    </View>
  );
}
