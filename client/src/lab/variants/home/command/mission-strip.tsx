import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Mission } from '@/domain/home-mission';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * COMMAND §1 — THE MISSION STRIP, the HUD's first line.
 *
 * The live MissionCard is a briefing: kicker, name, reward pills, muscle
 * line, estimates, hero CTA — right for a first impression, tall for a
 * 200th session. This strip is the same state machine compressed to the
 * three facts the daily athlete actually glances at: WHAT (the workout's
 * name), WHERE AM I (done/target sets, loud, right-aligned), HOW LONG
 * (~minutes), and one strong START/RESUME button. Every honest state the
 * card renders survives — loading skeleton, error with retry, rest day,
 * no plan (four doors), completed — because a veteran meets all of them
 * too; they are simply shorter here.
 *
 * STATIONARY BY DOCTRINE: no entrance, no sweep, no ambient anything.
 * The only motion is NeonButton's own one-shot press feedback.
 *
 * Sub-12px text sits on text-dim or brighter, never text-mute (the
 * audit's contrast rule); every touchable carries a real minHeight ≥ 44
 * (hitSlop has never worked on web).
 */
export function CommandMissionStrip({
  mission,
  title,
  sub,
  minutes,
  kcal,
  next,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  mission: Mission;
  /** splitWorkoutName over the mission's workout. */
  title: string;
  sub: string | null;
  minutes: number;
  kcal: number;
  next: NextSession | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Opens the lab workout for (today, mission.workout) with the source. */
  onOpen: () => void;
}) {
  const colors = useThemeColors();

  if (loading) {
    return (
      <GlowCard glow={colors.accent} padding={14}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 22, width: '58%' }} />
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 12, width: '36%' }} />
        <View className="mt-s3 rounded-md bg-surface-2" style={{ height: 44 }} />
      </GlowCard>
    );
  }

  if (error) {
    return (
      <GlowCard padding={14}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text className="mt-s2 text-base font-bold text-text">We couldn&apos;t load today&apos;s mission</Text>
        <Text className="mt-s1 text-xs text-text-dim">Check your connection — your logged sets are safe.</Text>
        <View className="mt-s3">
          <NeonButton title="RETRY" variant="ghost" pixel onPress={onRetry} testID="command-mission-retry" />
        </View>
      </GlowCard>
    );
  }

  const nextLine = next ? `Next mission: ${next.day} · ${whenLabel(next)}` : null;

  if (mission.status === 'rest_day') {
    return (
      <GlowCard padding={14}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text
          className="mt-s1 text-text"
          allowFontScaling={false}
          style={{ fontSize: 22, letterSpacing: 0, ...pixelFont() }}
        >
          RECOVERY DAY
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">
          Rest and recover.{nextLine ? ` ${nextLine}.` : ''}
        </Text>
        <View className="mt-s3">
          <NeonButton
            title="TRAIN ANYWAY"
            variant="ghost"
            pixel
            onPress={() => router.push('/today' as never)}
            testID="command-mission-rest-train"
          />
        </View>
      </GlowCard>
    );
  }

  if (mission.status === 'no_plan') {
    return (
      <GlowCard padding={14}>
        <Kicker>TODAY&apos;S MISSION</Kicker>
        <Text
          className="mt-s1 text-text"
          allowFontScaling={false}
          style={{ fontSize: 22, letterSpacing: 0, ...pixelFont() }}
        >
          NO MISSION ASSIGNED
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">Build a workout plan to begin progressing.</Text>
        <View className="mt-s3 flex-row flex-wrap" style={{ gap: 8 }}>
          <Door label="CREATE PLAN" testID="command-mission-create-plan" onPress={() => router.push('/routine' as never)} />
          <Door label="CREATE AI PLAN" tint={colors.epic} testID="command-mission-ai-plan" onPress={() => router.push('/ai' as never)} />
          <Door label="QUICK WORKOUT" testID="command-mission-quick" onPress={() => router.push('/today' as never)} />
          <Door label="SCAN WORKOUT" testID="command-mission-scan" onPress={() => router.push('/routine?import=1' as never)} />
        </View>
      </GlowCard>
    );
  }

  if (mission.status === 'completed') {
    return (
      <GlowCard glow={colors.success} padding={14}>
        <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="text-2xs font-bold" style={{ letterSpacing: 2, color: colors.success }}>
              ✓ MISSION COMPLETE
            </Text>
            <Text
              className="mt-s1 text-text"
              numberOfLines={1}
              allowFontScaling={false}
              style={{ fontSize: 22, letterSpacing: 0, ...pixelFont() }}
            >
              {title.toUpperCase()}
            </Text>
            <Text className="mt-s1 text-xs text-text-dim" numberOfLines={2}>
              {mission.doneSets > 0 || mission.xpBanked > 0
                ? `${mission.doneSets}${mission.targetSets > 0 ? ` / ${mission.targetSets}` : ''} sets · +${mission.xpBanked} XP banked`
                : 'Finished for today.'}
              {nextLine ? `  ·  ${nextLine}` : ''}
            </Text>
          </View>
          {/* The banked count, in the same loud right-hand slot the live
              count occupies while training — the HUD's gauge reads the same
              place in every state. Success green: the contract is honoured. */}
          <SetsGauge done={mission.doneSets} target={mission.targetSets} colour={colors.success} />
        </View>
        <View className="mt-s3">
          <NeonButton title="VIEW SUMMARY" variant="ghost" pixel onPress={onOpen} testID="command-mission-view" />
        </View>
      </GlowCard>
    );
  }

  // scheduled / in_progress — the strip proper. One glance: name on the
  // left, the done/target gauge on the right, the estimates line under
  // them, one button. The reward pills and muscle line the card carries
  // stayed on the card: a veteran has read them 200 times already.
  const inProgress = mission.status === 'in_progress';

  return (
    <GlowCard glow={colors.accent} padding={14}>
      <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View className="flex-row items-baseline" style={{ minWidth: 0 }}>
            <Kicker>{inProgress ? 'IN PROGRESS' : "TODAY'S MISSION"}</Kicker>
            {sub ? (
              // NBSP-joined on the kicker (the mission-card lesson): RN-web
              // collapses a leading space across sibling Text nodes.
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
            style={{ fontSize: 24, lineHeight: 29, letterSpacing: 0, ...pixelFont() }}
          >
            {title.toUpperCase()}
          </Text>
          {mission.targetSets > 0 ? (
            <Text
              className="mt-s1"
              numberOfLines={1}
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}
              testID="command-mission-estimates"
            >
              {mission.targetSets} SETS · ~{minutes} MIN · ~{kcal} CAL
            </Text>
          ) : null}
        </View>
        <SetsGauge done={mission.doneSets} target={mission.targetSets} colour={colors.accent} />
      </View>

      {/* The thin progress fill — only while a session is actually open. */}
      {inProgress && mission.targetSets > 0 ? (
        <View
          className="mt-s2 self-stretch overflow-hidden rounded-pill"
          style={{ height: 5, backgroundColor: colors['surface-3'] }}
          testID="command-mission-progress"
        >
          <View
            style={{
              width: `${Math.min(100, (mission.doneSets / mission.targetSets) * 100)}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: colors.accent,
            }}
          />
        </View>
      ) : null}

      <View className="mt-s3">
        <NeonButton
          title={inProgress ? 'RESUME MISSION' : 'START MISSION'}
          pixel
          onPress={onOpen}
          rightIcon={<Text style={{ color: colors['accent-ink'], fontSize: 16, fontWeight: '800' }}>›</Text>}
          testID="command-mission-start"
        />
      </View>
    </GlowCard>
  );
}

/** The HUD's gauge: done over target, loud, always in the strip's right
 *  slot. Never a tap of its own — the whole strip's action is the button. */
function SetsGauge({ done, target, colour }: { done: number; target: number; colour: string }) {
  const colors = useThemeColors();
  if (target <= 0) return null;
  return (
    <View className="items-end" pointerEvents="none" testID="command-mission-gauge">
      <Text allowFontScaling={false} style={{ fontSize: 26, lineHeight: 28, letterSpacing: 0, color: colour, ...pixelFont() }}>
        {done}
        <Text style={{ fontSize: 16, color: colors['text-dim'] }}>/{target}</Text>
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors['text-dim'], ...pixelFont(false) }}>
        SETS
      </Text>
    </View>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="tail"
      allowFontScaling={false}
      // text-dim, not text-mute: this is 10px type and the strip must not
      // reproduce the audit's contrast findings.
      style={{ fontSize: 10, letterSpacing: 2, fontWeight: '700', color: colors['text-dim'] }}
    >
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
      accessibilityLabel={label.toLowerCase()}
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
