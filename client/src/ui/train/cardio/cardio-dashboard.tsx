import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';

import { useCardioLog } from '@/data/hooks';
import {
  cardioStreak,
  dailyMission,
  DEFAULT_CARDIO_TARGETS,
  todayMinutes,
  weekStrip,
  weekTotals,
} from '@/domain/cardio-stats';
import { todayIso as calendarToday } from '@/domain/today';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';
import { ActivityTypeSelector } from '@/ui/train/cardio/activity-selector';
import { CardioMissionCard } from '@/ui/train/cardio/cardio-mission-card';
import { CardioSessionForm } from '@/ui/train/cardio/session-form';
import { RecentCardioSessions, type RecentRow } from '@/ui/train/cardio/recent-cardio-sessions';
import { WeeklyCardioProgress } from '@/ui/train/cardio/weekly-cardio-progress';

/**
 * CARDIO_MISSION_REDESIGN (2026-08-04) — raised to the same standard as the
 * 2026-08-03 Train/Home mission-briefing pass. MISSION → CHOOSE ACTIVITY →
 * ADAPTIVE LOGGER → THIS WEEK → RECENT SESSIONS, in one scroll. Every number
 * is derived from cardio_log; the goals are labelled defaults, not
 * fabricated user data. `type`/`setType` are lifted so the Train header's
 * companion animation stays in sync, and are nullable now: nothing is
 * silently pre-selected, so the mission card's first real state is
 * genuinely CHOOSE ACTIVITY (see cardio-mission-card.tsx's state table).
 * `intro`/`clock` are today.tsx's own entrance/ambient shared values — the
 * mission card is a window on them, never a second animation driver.
 */
export function CardioDashboard({
  type,
  setType,
  intro,
  clock,
}: {
  type: string | null;
  setType: (t: string) => void;
  intro: SharedValue<number>;
  clock: SharedValue<number>;
}) {
  const colors = useThemeColors();
  const today = calendarToday();
  const history = useCardioLog();
  const rows = history.data ?? [];

  const minsToday = todayMinutes(rows, today);
  const mission = dailyMission(minsToday, DEFAULT_CARDIO_TARGETS.dailyMinutes);
  const streak = cardioStreak(rows, today);
  const strip = weekStrip(rows, today);
  const totals = weekTotals(rows, today);

  // The form's own live preview, lifted so the mission card's CTA/reward
  // pill never disagree with what pressing LOG SESSION would actually save.
  const [pending, setPending] = useState({ mins: 0, xp: 0 });
  // The form registers its OWN submit handler here on mount — the mission
  // card's CTA calls THIS, never a duplicate of the save/budget-ask logic.
  const submitRef = useRef<(() => void) | null>(null);

  // THE NUDGE: pressing CHOOSE ACTIVITY / START SESSION / the post-complete
  // bonus-session CTA never jumps the scroll position (nothing below
  // ScreenShell exposes its ScrollView ref, and a page this short rarely
  // needs one) — it draws the eye with a one-shot glow pulse plus a light
  // haptic tick instead. One shared value, since only one section can ever
  // need the athlete's attention at a time.
  const sessionPulse = useSharedValue(0);
  const focusSession = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    sessionPulse.value = withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 560 }));
  };

  const recent: RecentRow[] = [...rows]
    .reverse()
    .slice(0, 5)
    .map((r) => ({
      id: String((r as { id: unknown }).id),
      type: String((r as { type: unknown }).type ?? 'Other'),
      minutes: pyFloat((r as { minutes: unknown }).minutes) ?? 0,
      distanceKm: pyFloat((r as Record<string, unknown>).distance_km) ?? 0,
      timestamp: String((r as { timestamp: unknown }).timestamp ?? ''),
      date: String((r as { date: unknown }).date ?? ''),
    }));

  return (
    <View style={{ gap: 16 }}>
      <CardioMissionCard
        mission={mission}
        weekSessions={totals.sessions}
        weeklyTarget={DEFAULT_CARDIO_TARGETS.weeklySessions}
        streak={streak}
        selectedType={type}
        pendingMinutes={pending.mins}
        pendingXp={pending.xp}
        onFocusSession={focusSession}
        onSubmit={() => submitRef.current?.()}
        intro={intro}
        clock={clock}
      />

      <AttentionGlow pulse={sessionPulse} tint={colors.accent}>
        <GlowCard testID="cardio-session-card">
          <SectionLabel>CHOOSE ACTIVITY</SectionLabel>
          <ActivityTypeSelector type={type} onSelect={setType} />
          <View className="mt-s4">
            {type ? (
              <>
                <Text
                  className="mb-s2 text-text-mute"
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
                >
                  SESSION DETAILS
                </Text>
                <CardioSessionForm
                  key={type}
                  type={type}
                  onPreviewChange={(mins, xp) => setPending({ mins, xp })}
                  registerSubmit={(fn) => {
                    submitRef.current = fn;
                  }}
                />
              </>
            ) : (
              <View
                className="items-center rounded-lg border border-dashed p-s4"
                style={{ borderColor: colors.border }}
                testID="cardio-session-empty"
              >
                <Text className="text-center text-2xs text-text-dim">
                  Choose an activity above — the log adapts to what you pick, so you only ever see the
                  fields that matter for it.
                </Text>
              </View>
            )}
          </View>
        </GlowCard>
      </AttentionGlow>

      <WeeklyCardioProgress strip={strip} totals={totals} />
      <RecentCardioSessions rows={recent} today={today} loading={history.isPending} error={history.isError} />
    </View>
  );
}

/** A one-shot glow pulse around whatever the mission card's CTA just pointed
 *  at — cheap (no repeating driver; `pulse` only ever moves on a press) and
 *  never gated behind useAmbient: that gate exists for permanent loops
 *  nobody looks at twice, and this is the opposite — a single reaction to a
 *  tap that settles back to zero on its own. */
function AttentionGlow({ pulse, tint, children }: { pulse: SharedValue<number>; tint: string; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    borderRadius: 14,
    shadowColor: tint,
    shadowOpacity: pulse.value * 0.65,
    shadowRadius: 6 + pulse.value * 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: pulse.value > 0.05 ? 10 : 0,
    transform: [{ scale: 1 + pulse.value * 0.008 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
