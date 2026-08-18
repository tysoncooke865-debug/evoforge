/**
 * ARCADE §4 — THE ENERGY METER.
 *
 * The week as a 7-segment power gauge over weeklyContract's pips (Monday
 * first): a filled bright segment is a trained day, TODAY is the glowing
 * segment with the variant's second (and last) ambient loop breathing on it,
 * a missed scheduled day is dark with a FULL-CONTRAST pixel cross (the
 * week-strip's 35%-alpha red was invisible — the meter must not soften a
 * state it renders), a pending day is the charged outline, rest/future stay
 * quiet. The streak counter burns legendary gold beside it.
 *
 * The gauge is one Pressable to /streak (the live strip's own door) and its
 * label speaks the whole state: trained, missed, streak. Reduced motion /
 * perf mode: the pulse pins to a steady lit halo — today is still findable
 * on a perfectly still screen.
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

import type { WeekDayPip } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelGlyph } from '@/ui/core/pixel-icons';
import { playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** The missed-day cross — pixel art, not a system glyph (the tofu lesson:
 *  Jersey's cmap gaps render missing glyphs as boxes on web). */
const CROSS = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] as const;

/** The streak flame — the clarity variant's grid, pixel-icons convention. */
const FLAME = [
  '...#...',
  '...##..',
  '..###..',
  '..###.#',
  '.#####.',
  '.######',
  '###.###',
  '##...##',
  '###.###',
  '.#####.',
] as const;

export function PowerGauge({
  pips,
  todayIso,
  streak,
  streakLabel,
}: {
  /** weeklyContract().pips — always 7, Monday first. */
  pips: WeekDayPip[];
  todayIso: string;
  streak: number;
  /** 'FORGE STREAK' when a schedule drives it, 'DAY STREAK' otherwise. */
  streakLabel: string;
}) {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const done = pips.filter((p) => p.state === 'completed').length;
  const missed = pips.filter((p) => p.state === 'missed').length;

  // The variant's SECOND ambient loop: today's segment breathes. Gated by
  // useAmbient; at rest the halo holds a steady mid-opacity, so the bright
  // segment never disappears for reduced-motion athletes.
  const beat = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      beat.value = 0;
      return;
    }
    beat.value = 0;
    beat.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1);
  }, [ambient, beat]);

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        playSelect();
        router.push('/streak' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${done} of 7 days trained, ${missed} missed, streak ${streak}. ${streakLabel.toLowerCase()}. Opens your streak.`}
      testID="arcade-power-gauge"
      className="w-full flex-row items-center rounded-xl border px-s4 py-s3"
      style={{ gap: 12, minHeight: 64, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          className="text-accent"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
        >
          WEEK POWER
        </Text>
        <View className="mt-s2 flex-row" style={{ gap: 4 }} testID="arcade-power-segments">
          {pips.map((pip, i) => (
            <Segment key={pip.date} letter={LETTERS[i]} state={pip.state} today={pip.date === todayIso} beat={beat} />
          ))}
        </View>
      </View>

      <View style={{ width: 1, height: 44, backgroundColor: colors.border }} />

      {/* Streak — legendary gold, the currency of consistency. */}
      <View className="items-center" style={{ minWidth: 56 }}>
        <Text
          className="text-text-dim"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          STREAK
        </Text>
        <View className="mt-s1 flex-row items-center" style={{ gap: 4 }}>
          <Text
            allowFontScaling={false}
            testID="arcade-power-streak"
            style={{
              fontSize: 24,
              lineHeight: 26,
              color: streak > 0 ? colors.legendary : colors['text-dim'],
              ...pixelFont(),
            }}
          >
            {streak}
          </Text>
          <View style={{ opacity: streak > 0 ? 1 : 0.35 }}>
            <PixelGlyph rows={FLAME} size={15} color={colors.legendary} testID="arcade-power-flame" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * One segment of the gauge. States mirror weeklyContract's DayState exactly
 * (the week-strip's own palette logic, re-shaped as a bar): completed fills
 * and glows, missed goes dark under a full-contrast cross, pending is the
 * charged outline, rest/future stay quiet — and TODAY is the bright one.
 */
function Segment({
  letter,
  state,
  today,
  beat,
}: {
  letter: string;
  state: string;
  today: boolean;
  beat: { value: number };
}) {
  const colors = useThemeColors();
  const done = state === 'completed';
  const palette: Record<string, { border: string; bg: string; letter: string }> = {
    completed: { bg: colors.accent, border: colors.accent, letter: colors.accent },
    // FULL contrast on the miss — the marker carries the state, the letter
    // stays readable red (danger is well above the sub-12px floor).
    missed: { bg: 'rgba(0,0,0,0.35)', border: colors.danger, letter: colors.danger },
    pending: { bg: 'rgba(34,211,238,0.12)', border: colors.accent, letter: colors.accent },
    rest: { bg: 'transparent', border: colors.border, letter: colors['text-dim'] },
    future: { bg: 'transparent', border: colors.border, letter: colors['text-dim'] },
  };
  const c = palette[state] ?? palette.future;

  // TODAY's halo derives from the shared beat; beat pinned at 0 (reduced
  // motion, perf mode, unfocused tab) resolves to a STEADY 0.45 — lit, still.
  const haloStyle = useAnimatedStyle(() => {
    if (!today) return { opacity: 0 };
    const wave = (1 - Math.cos(beat.value * Math.PI * 2)) / 2;
    return { opacity: 0.45 + wave * 0.45 };
  });

  return (
    <View className="items-center" style={{ flex: 1, maxWidth: 40, minWidth: 0 }}>
      <View style={{ alignSelf: 'stretch' }}>
        {today ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: -3,
                left: -3,
                right: -3,
                bottom: -3,
                borderRadius: 6,
                borderWidth: 1.5,
                borderColor: colors.accent,
              },
              haloStyle,
            ]}
          />
        ) : null}
        {/* ANIMATED-ADJACENT NODES CARRY INLINE STYLES (the xp-bar lesson) —
            the segment bar is plain, but its styles stay inline to match. */}
        <View
          style={{
            height: 20,
            borderRadius: 4,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: today ? 2 : 1,
            borderColor: today ? colors.accent : c.border,
            backgroundColor: c.bg,
            ...(done
              ? { shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 }
              : null),
          }}
        >
          {state === 'missed' ? <PixelGlyph rows={CROSS} size={9} color={colors.danger} /> : null}
        </View>
      </View>
      <Text
        allowFontScaling={false}
        style={{ marginTop: 3, fontSize: 10, color: today ? colors.accent : c.letter, ...pixelFont(false) }}
      >
        {letter}
      </Text>
    </View>
  );
}
