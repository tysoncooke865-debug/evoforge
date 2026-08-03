/**
 * HOME §5 (2026-08-03) — THIS WEEK.
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
 */

import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { WeekDayPip } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export function WeekStrip({
  pips,
  todayIso,
  streak,
  streakLabel,
}: {
  /** weeklyContract().pips — always 7, Monday first. */
  pips: WeekDayPip[];
  todayIso: string;
  streak: number;
  /** 'FORGE STREAK' when a schedule drives it, 'DAY STREAK' otherwise —
   *  spoken to screen readers; the visual label stays the short word. */
  streakLabel: string;
}) {
  const colors = useThemeColors();
  const done = pips.filter((p) => p.state === 'completed').length;

  return (
    <Pressable
      onPress={() => router.push('/streak' as never)}
      accessibilityRole="button"
      accessibilityLabel={`This week: ${done} of 7 days trained. ${streakLabel.toLowerCase()} ${streak}. Opens your streak.`}
      testID="week-strip"
      className="w-full flex-row items-center rounded-xl border px-s4 py-s3"
      style={{ gap: 12, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
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
            <DayPip key={pip.date} letter={LETTERS[i]} state={pip.state} today={pip.date === todayIso} />
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
    </Pressable>
  );
}

/** One day. `today` always draws the ring — the athlete must be able to find
 *  where they are standing even on a rest day. */
function DayPip({ letter, state, today }: { letter: string; state: string; today: boolean }) {
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
  return (
    <View
      className="items-center justify-center rounded-pill"
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
        borderWidth: today ? 2 : 1,
        borderColor: today ? colors.accent : c.border,
        backgroundColor: c.bg,
        // Completed days are the only ones that glow — that is the reward.
        ...(done
          ? { shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 9, elevation: 4 }
          : null),
      }}
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
    </View>
  );
}
