import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Mission } from '@/domain/home-mission';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBolt, PixelDumbbell, PixelMuscle } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';

import type { HomeFeatures } from './home-features';
import { useHomeScale } from './home-scale';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * HOME §4 — TODAY'S MISSION. One card, every honest state:
 * scheduled (brief + real reward + the page's ONE dominant CTA), in
 * progress (RESUME), completed (banked XP), rest day, no plan (four
 * doors), loading skeleton, error with retry.
 *
 * THE CTA USES THE ONE DOOR: /workout?date&workout&source — the same path
 * Train opens, source included, so Home can never start a different plan's
 * version of the day (the resolveDayIn lesson).
 *
 * 2026-08-03 REDESIGN — the card is now the page's primary CTA in weight as
 * well as in name (~30% of the first screen), and it got there by SAYING
 * LESS, not by growing padding:
 *   - the reward box that sat beside the title merged into ONE reward row
 *     with the muscle pills, so "what this buys me" reads as a single
 *     sentence instead of two competing blocks;
 *   - the three stacked icon/value/label metric stacks collapsed into one
 *     muted estimates line;
 *   - the caption under the button ("Begin workout") is gone — it repeated
 *     the button's own label back at the athlete.
 *
 * WHAT IS NOT HERE, DELIBERATELY: a "+0.4 EVO" reward. The mock shows one;
 * no such grant exists. The Evo Rating is recomputed from pillar evidence at
 * review time, so no workout can promise a rating delta in advance, and the
 * house rule (a system without a backend is hidden, never mocked) forbids
 * inventing the number. XP is real (10/set), the muscle read is real, and
 * coins are still never implied per-workout.
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
  const scale = useHomeScale();

  if (loading) {
    return (
      <GlowCard glow={colors.accent} padding={16}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 28, width: '62%' }} />
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 14, width: '40%' }} />
        <View className="mt-s4 rounded-md bg-surface-2" style={{ height: 60 }} />
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
        <Text className="mt-s2 text-text" allowFontScaling={false} style={{ fontSize: scale.missionTitle, letterSpacing: 0, ...pixelFont() }}>
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
        <Text className="mt-s2 text-text" allowFontScaling={false} style={{ fontSize: scale.missionTitle, letterSpacing: 0, ...pixelFont() }}>
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
        <Text className="mt-s1 text-text" allowFontScaling={false} style={{ fontSize: scale.missionTitle, letterSpacing: 0, ...pixelFont() }} numberOfLines={1}>
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
  const muscles = pills.slice(0, 2);
  return (
    <GlowCard glow={colors.accent} padding={16}>
      <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The qualifier ("Strength") rides the kicker rather than owning a
              line under the title: same words, 17pt of the first screen back,
              and the workout's NAME gets the whole line it deserves.
              TWO Texts, not one string: the qualifier is the only part
              allowed to shrink, so a long one ("Chest, Shoulders and
              Triceps") ellipsizes and the section label is never cut to
              "TODAY'S MISS…". The muscles that qualifier names are on the
              reward row below it regardless. The in-progress prefix drops
              "MISSION" for the same width — the RESUME MISSION button and the
              sets row already say which card this is. */}
          <View className="flex-row items-baseline" style={{ minWidth: 0 }}>
            <Kicker>{inProgress ? 'IN PROGRESS' : "TODAY'S MISSION"}</Kicker>
            {sub ? (
              // NBSP, not a space: RN-web renders each Text as its own DOM
              // node and HTML collapses a leading space, so " · STRENGTH"
              // arrived as "· STRENGTH" welded to the label.
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Kicker>{` · ${sub.toUpperCase()}`}</Kicker>
              </View>
            ) : null}
          </View>
          <Text
            className="mt-s2 text-text"
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling={false}
            style={{ fontSize: scale.missionTitle, lineHeight: Math.round(scale.missionTitle * 1.2), letterSpacing: 0, ...pixelFont() }}
          >
            {title.toUpperCase()}
          </Text>
        </View>
        {/* The session's mark — quiet, and it never takes a tap. */}
        <View pointerEvents="none" style={{ opacity: 0.42, paddingTop: 2 }}>
          <PixelDumbbell size={40} color={colors.accent} />
        </View>
      </View>

      {/* ONE reward row: what this session pays, and what it builds. */}
      {showRewards || muscles.length > 0 ? (
        <View className="mt-s2 flex-row flex-wrap items-center" style={{ gap: 6 }} testID="mission-rewards">
          {showRewards ? (
            <RewardPill
              icon={<PixelBolt size={12} color={colors.epic} />}
              label={`+${mission.xpReward} XP`}
              tint={colors.epic}
            />
          ) : null}
          {muscles.map((p) => (
            <RewardPill
              key={p}
              icon={<PixelMuscle size={12} color={colors.legendary} />}
              label={p}
              tint={colors.legendary}
            />
          ))}
          {pills.length > muscles.length ? (
            <RewardPill label={`+${pills.length - muscles.length}`} tint={colors['text-mute']} />
          ) : null}
        </View>
      ) : null}

      {/* ~ marks estimates — same honesty as the Train hero. One line: three
          stacked icon/value/label towers said no more than this does. */}
      {mission.targetSets > 0 ? (
        <Text
          className="mt-s1 text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
          testID="mission-estimates"
        >
          {mission.targetSets} SETS · ~{minutes} MIN · ~{kcal} CAL
        </Text>
      ) : null}

      {inProgress && mission.targetSets > 0 ? (
        <View className="mt-s3">
          <Text className="text-2xs text-text-dim" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }} testID="mission-progress">
            {mission.doneSets} / {mission.targetSets} SETS COMPLETED
          </Text>
          <View className="mt-s1 self-stretch overflow-hidden rounded-pill" style={{ height: 5, backgroundColor: colors['surface-3'] }}>
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
      </View>
    </GlowCard>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-2xs font-bold text-text-mute" numberOfLines={1} ellipsizeMode="tail" style={{ letterSpacing: 2 }}>
      {children}
    </Text>
  );
}

/** One reward/muscle token on the mission's single reward row. */
function RewardPill({ icon, label, tint }: { icon?: React.ReactNode; label: string; tint: string }) {
  return (
    <View
      className="flex-row items-center rounded-pill border px-s2"
      style={{ gap: 5, minHeight: 24, borderColor: `${tint}45`, backgroundColor: `${tint}12` }}
    >
      {icon}
      <Text
        className="text-center"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 11, letterSpacing: 0, color: tint, ...pixelFont() }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
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
