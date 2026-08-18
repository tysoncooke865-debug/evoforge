/**
 * ARCADE §3 — TODAY'S QUEST.
 *
 * The mission re-cut as the cabinet's quest banner: marquee lights around
 * the kicker, the workout's name as the quest title, muscle pills, the
 * reward line (the athlete's OWN measured Evo rate when one exists, the
 * real 10/set XP grant, ~minutes/~kcal estimates) and ONE dominant START
 * button. The insert-coin energy is NeonButton's hero sweep — the variant's
 * first of two ambient loops, gated inside neon-button.tsx itself; this
 * file animates nothing.
 *
 * Every honest state survives from the live card: loading skeleton, error
 * with retry, rest day (TRAIN ANYWAY), no plan (four working doors),
 * completed (banked XP + VIEW SUMMARY), in progress (sets bar + RESUME).
 * Data is the shared home model's mission slice; the CTA opens the model's
 * own door so every variant starts the identical workout.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { formatEvoEstimate } from '@/domain/progression/evo-per-session';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { homeFeatures } from '@/ui/home/home-features';
import { NeonButton } from '@/ui/core/neon-button';
import { RewardPill } from '@/ui/core/reward-pill';
import { GlowCard } from '@/ui/core/shell';

import type { HomeModel } from '../shared/use-home-model';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export function QuestBanner({ quest }: { quest: HomeModel['mission'] }) {
  const colors = useThemeColors();
  const m = quest.mission;

  if (quest.loading) {
    return (
      <GlowCard glow={colors.accent} padding={14} testID="arcade-quest-loading">
        <Marquee>TODAY&apos;S QUEST</Marquee>
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 26, width: '62%' }} />
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 14, width: '40%' }} />
        <View className="mt-s4 rounded-md bg-surface-2" style={{ height: 58 }} />
      </GlowCard>
    );
  }

  if (quest.error) {
    return (
      <GlowCard padding={14} testID="arcade-quest-error">
        <Marquee>TODAY&apos;S QUEST</Marquee>
        <Text className="mt-s2 text-base font-bold text-text">Quest data offline</Text>
        <Text className="mt-s1 text-xs text-text-dim">
          Check your connection — your logged sets are safe.
        </Text>
        <View className="mt-s3">
          <NeonButton title="RETRY" variant="ghost" pixel onPress={quest.retry} testID="arcade-quest-retry" />
        </View>
      </GlowCard>
    );
  }

  const nextLine = quest.next ? `Next quest: ${quest.next.day} · ${whenLabel(quest.next)}` : null;

  if (m.status === 'rest_day') {
    return (
      <GlowCard padding={14} testID="arcade-quest-rest">
        <Marquee>TODAY&apos;S QUEST</Marquee>
        <Text
          className="mt-s2 text-text"
          allowFontScaling={false}
          style={{ fontSize: 20, letterSpacing: 0, ...pixelFont() }}
        >
          RECOVERY DAY
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">
          Rest, recover and prepare for your next quest.{nextLine ? ` ${nextLine}.` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton
            title="TRAIN ANYWAY"
            variant="ghost"
            pixel
            onPress={() => router.push('/today' as never)}
            testID="arcade-quest-rest-train"
          />
        </View>
      </GlowCard>
    );
  }

  if (m.status === 'no_plan') {
    return (
      <GlowCard padding={14} testID="arcade-quest-noplan">
        <Marquee>TODAY&apos;S QUEST</Marquee>
        <Text
          className="mt-s2 text-text"
          allowFontScaling={false}
          style={{ fontSize: 20, letterSpacing: 0, ...pixelFont() }}
        >
          NO QUEST LOADED
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">Build a workout plan to begin progressing.</Text>
        <View className="mt-s3 flex-row flex-wrap" style={{ gap: 8 }}>
          <Door label="CREATE PLAN" testID="arcade-quest-create-plan" onPress={() => router.push('/routine' as never)} />
          <Door label="CREATE AI PLAN" tint={colors.epic} testID="arcade-quest-ai-plan" onPress={() => router.push('/ai' as never)} />
          <Door label="QUICK WORKOUT" testID="arcade-quest-quick" onPress={() => router.push('/today' as never)} />
          <Door label="SCAN WORKOUT" testID="arcade-quest-scan" onPress={() => router.push('/routine?import=1' as never)} />
        </View>
      </GlowCard>
    );
  }

  if (m.status === 'completed') {
    return (
      <GlowCard glow={colors.success} padding={14} testID="arcade-quest-complete">
        <Text className="text-2xs font-bold" style={{ letterSpacing: 2, color: colors.success }}>
          ✓ QUEST CLEAR
        </Text>
        <Text
          className="mt-s1 text-text"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 20, letterSpacing: 0, ...pixelFont() }}
        >
          {quest.title.toUpperCase()}
        </Text>
        <Text className="mt-s1 text-xs text-text-dim">
          {m.doneSets > 0 || m.xpBanked > 0
            ? `${m.doneSets}${m.targetSets > 0 ? ` / ${m.targetSets}` : ''} sets · +${m.xpBanked} XP banked`
            : 'Finished for today.'}
          {nextLine ? `  ·  ${nextLine}` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton title="VIEW SUMMARY" variant="ghost" pixel onPress={quest.open} testID="arcade-quest-view" />
        </View>
      </GlowCard>
    );
  }

  // scheduled / in_progress — the briefing banner and the page's ONE
  // dominant CTA.
  const inProgress = m.status === 'in_progress';
  const showXp = homeFeatures.showMissionRewards && m.xpReward > 0 && !inProgress;

  return (
    <GlowCard glow={colors.accent} padding={14} testID="arcade-quest">
      <Marquee>{inProgress ? 'QUEST IN PROGRESS' : "TODAY'S QUEST"}</Marquee>
      {quest.sub ? (
        <Text
          className="mt-s1 text-text-dim"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
        >
          {quest.sub.toUpperCase()}
        </Text>
      ) : null}
      <Text
        className="mt-s1 text-text"
        numberOfLines={1}
        ellipsizeMode="tail"
        allowFontScaling={false}
        style={{ fontSize: 22, lineHeight: 26, letterSpacing: 0, ...pixelFont() }}
      >
        {quest.title.toUpperCase()}
      </Text>

      {/* Muscle pills — cyan-outlined, matching the action colour family. */}
      {quest.pills.length > 0 ? (
        <View className="mt-s2 flex-row flex-wrap" style={{ gap: 6 }} testID="arcade-quest-muscles">
          {quest.pills.map((p) => (
            <View
              key={p}
              className="rounded-pill border"
              style={{
                borderColor: `${colors.accent}45`,
                backgroundColor: 'rgba(34,211,238,0.08)',
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text
                className="text-accent"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
              >
                {p.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* REWARD — purple Evo rate (a measurement, never a forecast), gold XP
          (the one real per-workout grant). The colour meanings the whole
          page keeps: purple=rating, gold=currency. */}
      {quest.evoPerSession !== null || showXp ? (
        <View className="mt-s2" testID="arcade-quest-rewards">
          <Text
            className="text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
          >
            REWARD
          </Text>
          <View className="mt-s1 flex-row flex-wrap items-center" style={{ gap: 8 }}>
            {quest.evoPerSession !== null ? (
              <RewardPill
                label={`◈ ${formatEvoEstimate(quest.evoPerSession)} EVO`}
                tint={colors.epic}
                size="lead"
                delay={0}
                testID="arcade-quest-evo"
              />
            ) : null}
            {showXp ? (
              <RewardPill label={`+${m.xpReward} XP`} tint={colors.legendary} delay={90} testID="arcade-quest-xp" />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Sets + estimates — ~ marks estimates, same honesty as live. */}
      {m.targetSets > 0 ? (
        <Text
          className="mt-s2 text-text-dim"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
          testID="arcade-quest-estimates"
        >
          {m.doneSets}/{m.targetSets} SETS · ~{quest.minutes} MIN · ~{quest.kcal} CAL
        </Text>
      ) : null}

      {inProgress && m.targetSets > 0 ? (
        <View
          className="mt-s2 self-stretch overflow-hidden rounded-pill"
          style={{ height: 5, backgroundColor: colors['surface-3'] }}
          testID="arcade-quest-progress"
        >
          <View
            style={{
              width: `${Math.min(100, (m.doneSets / m.targetSets) * 100)}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: colors.accent,
            }}
          />
        </View>
      ) : null}

      <View className="mt-s3">
        <NeonButton
          title={inProgress ? 'RESUME QUEST' : 'START QUEST'}
          pixel
          size="hero"
          sweep
          onPress={quest.open}
          rightIcon={<Text style={{ color: colors['accent-ink'], fontSize: 16, fontWeight: '800' }}>›</Text>}
          testID="arcade-quest-start"
        />
      </View>
    </GlowCard>
  );
}

/** The marquee kicker: two static light squares flank the label — cabinet
 *  lights at rest, never blinking (the flavour rule: cheap Views, no loops). */
function Marquee({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  const light = (key: string, on: boolean) => (
    <View
      key={key}
      style={{
        width: 4,
        height: 4,
        borderRadius: 1,
        backgroundColor: on ? colors.accent : `${colors.accent}40`,
      }}
    />
  );
  return (
    <View className="flex-row items-center" style={{ gap: 6 }}>
      {light('l1', true)}
      {light('l2', false)}
      <Text
        className="text-text-dim"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
      >
        {children}
      </Text>
      {light('r1', false)}
      {light('r2', true)}
    </View>
  );
}

/** A working door (44pt floor) — same four destinations as the live card. */
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
      <Text
        className="text-center"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0, color: tint, ...pixelFont() }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function whenLabel(next: NextSession): string {
  if (next.inDays === 1) return 'tomorrow';
  return `${WEEKDAYS[new Date(`${next.date}T00:00:00Z`).getUTCDay()].toLowerCase()} (in ${next.inDays} days)`;
}
