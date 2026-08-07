/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside effects and press handlers by design; the compiler lint
   cannot see that .value writes are UI-thread animation state. */
/**
 * HOME §4 — THIS WEEK.
 *
 * Seven days and a streak. Not statistics: the brief's rule for this band is
 * that it answers "am I keeping my word this week" in one glance and then
 * gets out of the way. The four weekly METRICS (sets, cardio minutes, XP,
 * workouts done/target) did not disappear — they are the TrainingOverview
 * card, which now lives below the fold where a number that needs reading
 * belongs.
 *
 * This strip and that card used to draw the SAME seven pips twice on one
 * page. They are merged here: the pips are the strip's job, and
 * TrainingOverview no longer renders them.
 *
 * States come straight from weeklyContract (Monday-start, effective-dated,
 * judged against the plan in force on each day). Completed days glow, today
 * always wears a ring whatever its state, a missed scheduled day reads as a
 * quiet warning rather than an alarm, and rest days stay silent.
 *
 * ---- MOTION (premium pass, 2026-08-03) ----
 *
 * TWO DRIVERS FOR THE WHOLE STRIP, and each earns its place:
 *
 *   `enter`  a ONE-SHOT that pops the completed days in, left to right, on
 *            mount. A day flips to completed on the workout screen, so the
 *            athlete's first sight of the new tick is THIS mount — the entry
 *            animation is the completion animation, at the only moment the
 *            athlete is actually looking.
 *   `beat`   an ambient pulse on TODAY's ring only. One pip breathing tells
 *            the eye where "now" is without a second colour.
 *
 * The pips derive their own stagger from `enter` inside their worklets, so
 * seven pips cost one driver rather than seven (the same rule the mote field
 * and the podium's tech layer follow).
 */

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { WeekDayPip } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
/** Each pip's pop occupies this slice of the entrance clock; the rest of the
 *  clock is its stagger. Seven pips over 1.0 with a 0.42 window means the last
 *  one starts as the fourth finishes — a wave, not a queue. */
const POP_WINDOW = 0.42;

export interface WeekTotalsSummary {
  sessionsDone: number;
  sessionsTarget: number;
  hasSchedule: boolean;
  sets: number;
  cardioMinutes: number;
  xp: number;
}

export function WeekStrip({
  pips,
  todayIso,
  streak,
  streakLabel,
  totals,
  lastSession,
}: {
  /** weeklyContract().pips — always 7, Monday first. */
  pips: WeekDayPip[];
  todayIso: string;
  streak: number;
  /** 'FORGE STREAK' when a schedule drives it, 'DAY STREAK' otherwise —
   *  spoken to screen readers; the visual label stays the short word. */
  streakLabel: string;
  /** THE WEEK'S NUMBERS, folded in (2026-08-07). They were a separate
   *  full-width card below the fold, so the seven days and the four numbers
   *  describing those same days never appeared together. */
  totals?: WeekTotalsSummary;
  /** The last completed session, one line. Was its own full-width card. */
  lastSession?: { name: string; when: string; detail: string } | null;
}) {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const reduced = useReducedMotion();
  const done = pips.filter((p) => p.state === 'completed').length;

  // The entrance is a ONE-SHOT and therefore not perf-gated (the animations.ts
  // doctrine: never disable one-shots). Reduced motion pins it complete.
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = 0;
    enter.value = withTiming(1, { duration: 760, easing: Easing.out(Easing.cubic) });
  }, [reduced, enter]);

  // TODAY's ring breathes. Ambient, so an unfocused tab holds it lit.
  const beat = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      beat.value = 0;
      return;
    }
    beat.value = 0;
    beat.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1);
  }, [ambient, beat]);

  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={pressStyle}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          playSelect();
          router.push('/streak' as never);
        }}
        onPressIn={() => {
          press.value = withSpring(0.98, { damping: 20, stiffness: 380 });
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 15, stiffness: 300 });
        }}
        accessibilityRole="button"
        accessibilityLabel={`This week: ${done} of 7 days trained. ${streakLabel.toLowerCase()} ${streak}. Opens your streak.`}
        testID="week-strip"
        className="w-full rounded-xl border px-s4 py-s3"
        style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
      >
        {/* The seven days and the streak, side by side as before. */}
        <View className="w-full flex-row items-center" style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            className="text-accent"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            THIS WEEK
          </Text>
          {/* testID so the pip row's geometry is FALSIFIABLE from a browser
              tour — the 320pt overflow this file was fixed for is invisible to
              every static check. */}
          <View testID="week-pips" className="mt-s2 flex-row items-center justify-between" style={{ gap: 2 }}>
            {pips.map((pip, i) => (
              <DayPip
                key={pip.date}
                letter={LETTERS[i]}
                state={pip.state}
                today={pip.date === todayIso}
                index={i}
                enter={enter}
                beat={beat}
              />
            ))}
          </View>
        </View>

        <View style={{ width: 1, height: 40, backgroundColor: colors.border }} />

        <View className="items-center" style={{ minWidth: 56 }}>
          <Text
            className="text-text-mute"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            STREAK
          </Text>
          <View className="mt-s1 flex-row items-center" style={{ gap: 4 }}>
            <Text
              allowFontScaling={false}
              testID="week-strip-streak"
              style={{
                fontSize: 24,
                lineHeight: 26,
                letterSpacing: 0,
                color: streak > 0 ? colors.legendary : colors['text-mute'],
                ...pixelFont(),
              }}
            >
              {streak}
            </Text>
            <Text allowFontScaling={false} style={{ fontSize: 15, opacity: streak > 0 ? 1 : 0.35 }}>
              🔥
            </Text>
          </View>
        </View>
        </View>

        {/* THE WEEK'S NUMBERS, in the card that shows the week. Three
            full-width cards became one (2026-08-07): the pips, the totals and
            the last session all described the same seven days from three
            different places on the page. */}
        {totals ? (
          <View
            className="mt-s3 flex-row flex-wrap border-t pt-s3"
            style={{ borderColor: colors.border, columnGap: 18, rowGap: 8 }}
            testID="week-strip-totals"
          >
            {/* HIERARCHY, not four equal numbers (2026-08-07). SESSIONS and
                XP are the week's story and carry the weight; sets and cardio
                are the detail behind them and step back a size. */}
            <Metric
              label="SESSIONS"
              value={
                totals.hasSchedule
                  ? `${totals.sessionsDone} / ${totals.sessionsTarget}`
                  : String(totals.sessionsDone)
              }
              lead
            />
            <Metric label="XP" value={`+${totals.xp}`} tint={colors.accent} lead />
            <Metric label="SETS" value={String(totals.sets)} />
            <Metric label="CARDIO" value={`${Math.trunc(totals.cardioMinutes)}m`} tint={colors.rare} />
          </View>
        ) : null}

        {lastSession ? (
          <Text
            className="mt-s2 text-2xs text-text-mute"
            numberOfLines={1}
            testID="week-strip-last"
            style={{ letterSpacing: 0.3 }}
          >
            LAST · {lastSession.name} · {lastSession.when} · {lastSession.detail}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** One day. `today` always draws the ring — the athlete must be able to find
 *  where they are standing even on a rest day. */
function DayPip({
  letter,
  state,
  today,
  index,
  enter,
  beat,
}: {
  letter: string;
  state: string;
  today: boolean;
  index: number;
  enter: { value: number };
  beat: { value: number };
}) {
  const colors = useThemeColors();
  const done = state === 'completed';
  const palette: Record<string, { border: string; bg: string; text: string }> = {
    completed: { bg: colors.accent, border: colors.accent, text: colors['accent-ink'] },
    missed: { bg: 'transparent', border: `${colors.danger}59`, text: `${colors.danger}99` },
    pending: { bg: 'rgba(34,211,238,0.12)', border: colors.accent, text: colors.accent },
    rest: { bg: 'transparent', border: colors.border, text: colors['text-mute'] },
    future: { bg: 'transparent', border: colors.border, text: colors['text-dim'] },
  };
  const c = palette[state] ?? palette.future;

  // Only completed days pop — the reward is for the day you earned, and a
  // future Thursday springing into view would read as a reward for nothing.
  const start = (index / 7) * (1 - POP_WINDOW);
  const popStyle = useAnimatedStyle(() => {
    if (!done) return { transform: [{ scale: 1 }] };
    const p = Math.max(0, Math.min(1, (enter.value - start) / POP_WINDOW));
    // Overshoot at ~70% of the window, settle at 1 — a spring shape without a
    // spring's second driver.
    const overshoot = Math.sin(p * Math.PI) * 0.18;
    return { transform: [{ scale: 0.6 + p * 0.4 + overshoot }], opacity: p };
  });

  // TODAY's ring breathes; every other pip's ring is static. A day that is
  // BOTH today and DONE breathes brighter and wider — the strongest state on
  // the strip belongs to the thing the athlete just earned (2026-08-07).
  const ringStyle = useAnimatedStyle(() => {
    if (!today) return { opacity: 0 };
    const wave = (1 - Math.cos(beat.value * Math.PI * 2)) / 2;
    if (done) return { opacity: 0.45 + wave * 0.55, transform: [{ scale: 1 + wave * 0.24 }] };
    return { opacity: 0.25 + wave * 0.55, transform: [{ scale: 1 + wave * 0.16 }] };
  });

  return (
    <View
      className="items-center justify-center"
      style={{
        // FLEXIBLE squares, not rigid ones. ~147pt of this row is spoken for
        // before a pip is drawn (page padding, card padding, two gaps, the
        // divider, the streak column), so seven 30pt pips need a viewport
        // wider than ~357 — under it (an SE, a Fold cover screen, ANY iPhone
        // in Display Zoom) the last two days used to draw straight over the
        // divider and the streak number. maxWidth pins the tuned look
        // wherever there is room; aspectRatio keeps them circles as they
        // shrink.
        flex: 1,
        maxWidth: 30,
        aspectRatio: 1,
      }}
    >
      {/* TODAY's halo, behind the pip. Its own node so the pulse never
          animates the pip's own border width (a layout property). */}
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
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: colors.accent,
            },
            ringStyle,
          ]}
        />
      ) : null}
      <Animated.View
        style={[
          {
            // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson).
            // `className="rounded-pill items-center justify-center"` here was
            // silently DROPPED by the NativeWind interop on web and every day
            // rendered as a SQUARE — caught in the browser tour, invisible to
            // tsc and to lint. If it must be styled and it must animate, the
            // style is inline. No exceptions on this file.
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            width: '100%',
            height: '100%',
            borderWidth: today ? 2 : 1,
            borderColor: today ? colors.accent : c.border,
            backgroundColor: c.bg,
            // Completed days are the only ones that glow — that is the reward.
            ...(done
              ? { shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 9, elevation: 4 }
              : null),
          },
          popStyle,
        ]}
      >
        {/* The tick stays on the SYSTEM face: Jersey's cmap has no U+2713, and a
            missing glyph in a pixel font renders as tofu on web (the same
            lesson U+2192 taught the Evo card). Only the letters are pixel. */}
        {done ? (
          <Text allowFontScaling={false} style={{ fontSize: 12, fontWeight: '800', color: c.text }}>
            ✓
          </Text>
        ) : (
          <Text allowFontScaling={false} style={{ fontSize: 12, color: c.text, ...pixelFont() }}>
            {letter}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

/** One of the week's four numbers. Compact by design — these SUPPORT the seven
 *  days above them; they do not compete with them. */
function Metric({
  label,
  value,
  tint,
  lead,
}: {
  label: string;
  value: string;
  tint?: string;
  /** The week's headline numbers. Everything else supports them. */
  lead?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{
          fontSize: lead ? 18 : 14,
          letterSpacing: 0,
          color: tint ?? (lead ? colors.text : colors['text-dim']),
          ...pixelFont(),
        }}
      >
        {value}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 7, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}
