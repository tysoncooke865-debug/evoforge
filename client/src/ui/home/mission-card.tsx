import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import type { Mission } from '@/domain/home-mission';
import { formatEvoEstimate } from '@/domain/progression/evo-per-session';
import { evoEvidenceFor, evoEvidenceLabel } from '@/domain/progression/session-evidence';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBolt, PixelDumbbell } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';

import type { HomeFeatures } from './home-features';
import { useHomeScale } from './home-scale';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * HOME §3 — TODAY'S MISSION. One card, every honest state:
 * scheduled (brief + real reward + the page's ONE dominant CTA), in
 * progress (RESUME), completed (banked XP), rest day, no plan (four
 * doors), loading skeleton, error with retry.
 *
 * THE CTA USES THE ONE DOOR: /workout?date&workout&source — the same path
 * Train opens, source included, so Home can never start a different plan's
 * version of the day (the resolveDayIn lesson).
 *
 * ---- THE HIERARCHY (premium pass, 2026-08-03) ----
 *
 * The brief asks that an athlete know six things at a glance, in this order,
 * and the card is now laid out as exactly that list — one idea per line, each
 * quieter than the one above it:
 *
 *   WORKOUT     the kicker carries the qualifier, the NAME owns its own line
 *   REWARD      one row of two pills: what it pays, and what it proves
 *   MUSCLES     a muted line, not pills — three outlined chips for three
 *               words was chrome competing with the reward above them
 *   DURATION    the estimates line, ~ marked, same honesty as the Train hero
 *   CTA         a hero button with a light sweep across it
 *
 * ---- ESTIMATED REWARDS, WITH EVO FIRST (2026-08-03, third brief) ----
 *
 * Tyson asked three times for "+0.4 EVO", ranked ABOVE the XP. It is here, and
 * it is a MEASUREMENT rather than the forecast the mock implied:
 * `domain/progression/evo-per-session.ts` divides the athlete's real rating
 * gain by the training days that produced it, so "+0.4" is *their own recent
 * rate*, personal and checkable against their own history. A forecast of what
 * this specific session will be worth still cannot exist — the rating is
 * recomputed from the whole evidence base at review time (see
 * `session-evidence.ts`) — which is why the block is headed ESTIMATED and why
 * the number DISAPPEARS entirely rather than degrading to a default when the
 * athlete has too little history to have a rate. A new athlete sees the pillar
 * benefit only, until they have earned a number of their own.
 *
 * PRIMARY BENEFIT is the pillar read, which needs no history and is true from
 * the first session: a logged resistance set is Strength and Size evidence,
 * straight off the review's own inputs. XP is real (10/set) and now sits
 * second by size and by colour. Coins are still never implied per-workout.
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
  evoPerSession,
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
  /** The athlete's OWN measured Evo-per-training-day, or null when they have
   *  too little history for the average to mean anything. Never defaulted —
   *  see domain/progression/evo-per-session.ts. */
  evoPerSession: number | null;
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
        {/* The loop closed: the sets are banked AND they are now evidence.
            Said once, at the moment it becomes true. */}
        <Text className="mt-s2 text-2xs" style={{ color: colors.epic, letterSpacing: 1 }} testID="mission-evo-banked">
          ◈ BANKED AS EVIDENCE FOR YOUR NEXT EVO REVIEW
          {evoPerSession !== null ? `  ·  ${formatEvoEstimate(evoPerSession)} EVO/SESSION` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton title="VIEW SUMMARY" variant="ghost" pixel onPress={onOpen} testID="mission-view" />
        </View>
      </GlowCard>
    );
  }

  // scheduled / in_progress — the briefing card. Its padding is 14 rather
  // than the card default 16: the CTA inside it is the page's one dominant
  // action and has to clear the PHONE's fold, and 2pt of inner air is a
  // cheaper thing to spend than the champion's size.
  const inProgress = mission.status === 'in_progress';
  const showRewards = features.showMissionRewards && mission.xpReward > 0 && !inProgress;
  const evoLabel = evoEvidenceLabel(evoEvidenceFor({ sets: mission.targetSets, cardioMinutes: 0 }));
  const muscles = pills.slice(0, 3);

  return (
    <GlowCard glow={colors.accent} padding={14}>
      <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The qualifier ("Strength") rides the kicker rather than owning a
              line under the title: same words, 17pt of the first screen back,
              and the workout's NAME gets the whole line it deserves.
              TWO Texts, not one string: the qualifier is the only part
              allowed to shrink, so a long one ("Chest, Shoulders and
              Triceps") ellipsizes and the section label is never cut to
              "TODAY'S MISS…". The muscles that qualifier names are on their
              own line below regardless. The in-progress prefix drops
              "MISSION" for the same width — the RESUME MISSION button and the
              sets row already say which card this is. */}
          <View className="flex-row items-baseline" style={{ minWidth: 0 }}>
            <Kicker>{inProgress ? 'IN PROGRESS' : "TODAY'S MISSION"}</Kicker>
            {sub ? (
              // NBSP, not a space: RN-web renders each Text as its own DOM
              // node and HTML collapses a leading space, so " · STRENGTH"
              // arrived as "· STRENGTH" welded to the label.
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Kicker>{` · ${sub.toUpperCase()}`}</Kicker>
              </View>
            ) : null}
          </View>
          <Text
            className="mt-s1 text-text"
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

      {/* ESTIMATED REWARDS — the Evo gain is the biggest thing in the block,
          XP is second, and the pillar benefit names what it buys. Purple is
          the rating, gold is currency: the same meanings those colours carry
          everywhere else on the page. */}
      {showRewards || evoPerSession !== null || evoLabel ? (
        <View className="mt-s2" testID="mission-rewards">
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
          >
            ESTIMATED REWARDS
          </Text>
          <View className="mt-s1 flex-row flex-wrap items-center" style={{ gap: 8 }}>
            {evoPerSession !== null ? (
              <RewardPill
                label={`◈ ${formatEvoEstimate(evoPerSession)} EVO`}
                tint={colors.epic}
                size="lead"
                delay={0}
                testID="mission-evo-gain"
              />
            ) : null}
            {showRewards ? (
              <RewardPill
                icon={<PixelBolt size={11} color={colors.legendary} />}
                label={`+${mission.xpReward} XP`}
                tint={colors.legendary}
                delay={90}
                testID="mission-xp"
              />
            ) : null}
          </View>
          {evoLabel ? (
            <Text
              className="mt-s2"
              numberOfLines={1}
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1.2, color: colors['text-mute'], ...pixelFont(false) }}
              testID="mission-evo"
            >
              {'PRIMARY BENEFIT  '}
              <Text style={{ color: colors['text-dim'], ...pixelFont() }}>{evoLabel}</Text>
              {muscles.length > 0 ? `  ·  ${muscles.join(' · ').toUpperCase()}` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* DURATION — ~ marks estimates, same honesty as the Train hero. */}
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
          sweep
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

/**
 * One token on the mission's reward row.
 *
 * `lead` is the Evo gain: bigger type, a heavier outline and a soft bloom, so
 * the reward the whole app is about outranks the XP beside it at a glance
 * rather than by reading order alone.
 *
 * Each pill POPS IN once, staggered — the brief's "tiny pulse when appearing".
 * It is a ONE-SHOT (not perf-gated, per the animations.ts doctrine) and
 * reduced motion pins it at rest, fully visible: a reward chip that never
 * arrives is worse than one that does not bounce.
 */
function RewardPill({
  icon,
  label,
  tint,
  testID,
  size = 'base',
  delay = 0,
}: {
  icon?: React.ReactNode;
  label: string;
  tint: string;
  testID?: string;
  size?: 'base' | 'lead';
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const lead = size === 'lead';
  const pop = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    pop.value = withDelay(delay, withTiming(1, { duration: 320, easing: Easing.out(Easing.back(2)) }));
  }, [reduced, delay, pop]);

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 1.6),
    transform: [{ scale: 0.86 + pop.value * 0.14 }],
  }));

  return (
    <Animated.View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 999,
          borderWidth: lead ? 1.5 : 1,
          paddingHorizontal: lead ? 12 : 8,
          gap: 5,
          minHeight: lead ? 32 : 26,
          borderColor: lead ? `${tint}8c` : `${tint}45`,
          backgroundColor: lead ? `${tint}1f` : `${tint}12`,
          ...(lead ? { shadowColor: tint, shadowOpacity: 0.45, shadowRadius: 12, elevation: 4 } : null),
        },
        style,
      ]}
    >
      {icon}
      <Text
        className="text-center"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: lead ? 15 : 11, letterSpacing: 0, color: tint, ...pixelFont() }}
      >
        {label.toUpperCase()}
      </Text>
    </Animated.View>
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
