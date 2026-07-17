import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Mission } from '@/domain/home-mission';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBars, PixelClock, PixelFlame } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';

import type { HomeFeatures } from './home-features';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * HOME_REDESIGN §4 — TODAY'S MISSION. One card, every honest state:
 * scheduled (brief + real reward + the page's ONE dominant CTA), in
 * progress (RESUME), completed (banked XP), rest day, no plan (four
 * doors), loading skeleton, error with retry.
 *
 * THE CTA USES THE ONE DOOR: /workout?date&workout&source — the same path
 * Train opens, source included, so Home can never start a different plan's
 * version of the day (the resolveDayIn lesson).
 *
 * The reward strip is activityXp over the plan's sets — the exact grant the
 * ledger will mint — and coins are NEVER implied (no per-workout coin grant
 * exists). Estimates wear ~, exactly like the Train hero.
 */
export function MissionCard({
  mission,
  title,
  sub,
  pills,
  minutes,
  kcal,
  next,
  loading,
  error,
  onRetry,
  onOpen,
  features,
}: {
  mission: Mission;
  /** splitWorkoutName over the mission's workout. */
  title: string;
  sub: string | null;
  pills: string[];
  minutes: number;
  kcal: number;
  next: NextSession | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Opens the workout page for (today, mission.workout) with the source. */
  onOpen: () => void;
  features: HomeFeatures;
}) {
  const colors = useThemeColors();
  if (loading) {
    return (
      <GlowCard glow={colors.accent} padding={16}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 24, width: '62%' }} />
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 12, width: '40%' }} />
        <View className="mt-s3 rounded-md bg-surface-2" style={{ height: 52 }} />
      </GlowCard>
    );
  }

  if (error) {
    return (
      <GlowCard padding={16}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text className="mt-s2 text-base font-bold text-text">We couldn&apos;t load today&apos;s mission</Text>
        <Text className="mt-s1 text-xs text-text-dim">Check your connection — your logged sets are safe.</Text>
        <View className="mt-s3">
          <NeonButton title="RETRY" variant="ghost" pixel onPress={onRetry} testID="mission-retry" />
        </View>
      </GlowCard>
    );
  }

  const nextLine = next ? `Next mission: ${next.day} · ${whenLabel(next)}` : null;

  if (mission.status === 'rest_day') {
    return (
      <GlowCard padding={16}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text className="mt-s2 text-text" allowFontScaling={false} style={{ fontSize: 19, letterSpacing: 0, ...pixelFont() }}>
          RECOVERY DAY
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">
          Rest, recover and prepare for your next mission.{nextLine ? ` ${nextLine}.` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton
            title="TRAIN ANYWAY"
            variant="ghost"
            pixel
            onPress={() => router.push('/today' as never)}
            testID="mission-rest-train"
          />
        </View>
      </GlowCard>
    );
  }

  if (mission.status === 'no_plan') {
    return (
      <GlowCard padding={16}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text className="mt-s2 text-text" allowFontScaling={false} style={{ fontSize: 19, letterSpacing: 0, ...pixelFont() }}>
          NO MISSION ASSIGNED
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">Build a workout plan to begin progressing.</Text>
        <View className="mt-s3 flex-row flex-wrap" style={{ gap: 8 }}>
          <Door label="CREATE PLAN" testID="mission-create-plan" onPress={() => router.push('/routine' as never)} />
          <Door label="CREATE AI PLAN" tint={colors.epic} testID="mission-ai-plan" onPress={() => router.push('/ai' as never)} />
          <Door label="QUICK WORKOUT" testID="mission-quick" onPress={() => router.push('/today' as never)} />
          <Door label="SCAN WORKOUT" testID="mission-scan" onPress={() => router.push('/routine?import=1' as never)} />
        </View>
      </GlowCard>
    );
  }

  if (mission.status === 'completed') {
    return (
      <GlowCard glow={colors.success} padding={16}>
        <Text className="text-2xs font-bold" style={{ letterSpacing: 2, color: colors.success }}>
          ✓ MISSION COMPLETE
        </Text>
        <Text className="mt-s1 text-text" allowFontScaling={false} style={{ fontSize: 19, letterSpacing: 0, ...pixelFont() }} numberOfLines={1}>
          {title.toUpperCase()}
        </Text>
        <Text className="mt-s1 text-xs text-text-dim">
          {mission.doneSets > 0 || mission.xpBanked > 0
            ? `${mission.doneSets}${mission.targetSets > 0 ? ` / ${mission.targetSets}` : ''} sets · +${mission.xpBanked} XP banked`
            : 'Finished for today.'}
          {nextLine ? `  ·  ${nextLine}` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton title="VIEW SUMMARY" variant="ghost" pixel onPress={onOpen} testID="mission-view" />
        </View>
      </GlowCard>
    );
  }

  // scheduled / in_progress — the briefing card.
  const inProgress = mission.status === 'in_progress';
  const showRewards = features.showMissionRewards && mission.xpReward > 0 && !inProgress;
  return (
    <GlowCard glow={colors.accent} padding={16}>
      <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Kicker>{inProgress ? 'MISSION IN PROGRESS' : "TODAY'S MISSION"}</Kicker>
          <Text
            className="mt-s2 text-text"
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling={false}
            style={{ fontSize: 21, lineHeight: 28, letterSpacing: 0, ...pixelFont() }}
          >
            {title.toUpperCase()}
          </Text>
          {sub ? (
            <Text className="text-sm text-text-dim" numberOfLines={1} ellipsizeMode="tail">
              {sub}
            </Text>
          ) : null}
          {pills.length > 0 ? (
            <View className="mt-s2 flex-row flex-wrap" style={{ gap: 4 }}>
              {pills.slice(0, 3).map((p) => (
                <View key={p} className="rounded-pill border bg-surface-2 px-s2 py-s1" style={{ borderColor: colors.border }}>
                  <Text className="text-center text-2xs font-bold text-text-dim" numberOfLines={1}>
                    {p}
                  </Text>
                </View>
              ))}
              {pills.length > 3 ? (
                <View className="rounded-pill border bg-surface-2 px-s2 py-s1" style={{ borderColor: colors.border }}>
                  <Text className="text-center text-2xs font-bold text-text-dim">+{pills.length - 3}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* REWARDS — real XP only. Coins have no per-workout grant. */}
        {showRewards ? (
          <View
            className="items-start rounded-md border px-s2 py-s2"
            style={{ borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.07)' }}
            testID="mission-rewards"
          >
            <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}>
              REWARDS
            </Text>
            <Text className="mt-s1" allowFontScaling={false} style={{ fontSize: 13, letterSpacing: 0, color: colors.epic, ...pixelFont() }}>
              +{mission.xpReward} XP
            </Text>
          </View>
        ) : null}
      </View>

      {/* ~ marks estimates — same honesty as the Train hero. */}
      {mission.targetSets > 0 ? (
        <View className="mt-s3 flex-row items-center" style={{ gap: 12, rowGap: 4, flexWrap: 'wrap' }}>
          {(
            [
              [<PixelBars key="sets" size={16} color={colors['text-dim']} />, String(mission.targetSets), 'SETS'],
              [<PixelClock key="min" size={16} color={colors['text-dim']} />, String(minutes), 'EST. MIN'],
              [<PixelFlame key="kcal" size={16} color={colors['text-dim']} />, String(kcal), 'EST. CAL'],
            ] as const
          ).map(([icon, value, label]) => (
            <View key={label} className="flex-row items-center" style={{ gap: 6 }}>
              {icon}
              <View className="items-start">
                <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
                  {value}
                </Text>
                <Text className="text-text-mute" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0, ...pixelFont(false) }}>
                  {label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {inProgress && mission.targetSets > 0 ? (
        <View className="mt-s3">
          <Text className="text-2xs text-text-dim" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }} testID="mission-progress">
            {mission.doneSets} / {mission.targetSets} SETS COMPLETED
          </Text>
          <View className="mt-s1 self-stretch overflow-hidden rounded-pill" style={{ height: 4, backgroundColor: colors['surface-3'] }}>
            <View
              style={{
                width: `${Math.min(100, (mission.doneSets / mission.targetSets) * 100)}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: colors.accent,
              }}
            />
          </View>
        </View>
      ) : null}

      <View className="mt-s3">
        <NeonButton
          title={inProgress ? 'RESUME MISSION' : 'START MISSION'}
          pixel
          size="hero"
          onPress={onOpen}
          rightIcon={<Text style={{ color: colors['accent-ink'], fontSize: 16, fontWeight: '800' }}>›</Text>}
          testID="mission-start"
        />
        <Text className="mt-s1 text-center text-2xs text-text-mute">
          {inProgress ? 'Continue workout' : 'Begin workout'}
        </Text>
      </View>
    </GlowCard>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
      {children}
    </Text>
  );
}

function Door({
  label,
  onPress,
  testID,
  tint: tintProp,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tint?: string;
}) {
  const colors = useThemeColors();
  const tint = tintProp ?? colors.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className="rounded-md border px-s3"
      style={{
        minHeight: 44,
        justifyContent: 'center',
        flexGrow: 1,
        flexBasis: '45%',
        borderColor: `${tint}59`,
        backgroundColor: 'rgba(13,21,36,0.72)',
      }}
    >
      <Text className="text-center" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 0, color: tint, ...pixelFont() }}>
        {label}
      </Text>
    </Pressable>
  );
}

function whenLabel(next: NextSession): string {
  if (next.inDays === 1) return 'tomorrow';
  return `${WEEKDAYS[new Date(`${next.date}T00:00:00Z`).getUTCDay()].toLowerCase()} (in ${next.inDays} days)`;
}
