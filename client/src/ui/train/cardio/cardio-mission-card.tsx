/**
 * THE CARDIO MISSION CARD (2026-08-04) — the CARDIO mode's equivalent of
 * Train's mission brief (ui/train/mission-brief.tsx): the one thing on the
 * screen that says WHAT today's conditioning mission is, WHAT IT PAYS, and
 * WHERE TO GO NEXT, before anything below it needs to be read.
 *
 * It replaces the old DailyCardioSummary as the page's focal point. Every
 * number on it is real (domain/cardio-stats.ts's dailyMission/streak/week
 * totals, domain/cardio.ts's cardioEventAmount — the same migration-002
 * literal the save actually grants), and it shares the Train hero's own
 * entrance clock: `intro`/`clock` are passed down from today.tsx, the SAME
 * shared values the LIFT-mode mission card animates on, so switching the
 * LIFT/CARDIO segmented tab never starts a second animation driver.
 *
 * ---- THE CTA READS THE WHOLE PAGE'S STATE, NOT JUST ITS OWN ----
 *
 * Four honest states (a fifth — CONTINUE SESSION, for an in-progress cardio
 * session — is not modelled: cardio logging is a single write, there is no
 * "in progress" to resume, and inventing one would be exactly the kind of
 * button that performs no meaningful action the brief warns against):
 *
 *   nothing chosen         CHOOSE ACTIVITY  → nudges the session card open
 *   chosen, no minutes yet START SESSION    → nudges the (now visible) form
 *   minutes entered        LOG SESSION      → fires the form's OWN submit
 *                                              path via `onSubmit` (a ref the
 *                                              form registers itself into —
 *                                              see session-form.tsx), never a
 *                                              second copy of the save logic
 *   today's target met     MISSION COMPLETE → still opens the session card,
 *                                              because a finished MISSION
 *                                              does not mean the athlete is
 *                                              done training for the day
 */

import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { cardioEventAmount } from '@/domain/cardio';
import type { DailyMission } from '@/domain/cardio-stats';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { MissionLabel as Label, MissionProgressBar as ProgressBar } from '@/ui/core/mission-kit';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBolt, PixelClock, PixelFlame, PixelHeart } from '@/ui/core/pixel-icons';
import { RewardPill } from '@/ui/core/reward-pill';
import { GlowCard } from '@/ui/core/shell';
import { activityFor } from '@/ui/train/cardio/activities';
import { STAGE } from '@/ui/train/train-scale';

/** 0 outside [a,b], 0→1 across it. Worklet-safe — mirrors mission-brief's. */
const seg = (t: number, a: number, b: number): number => {
  'worklet';
  return Math.max(0, Math.min(1, (t - a) / (b - a)));
};

export function CardioMissionCard({
  mission,
  weekSessions,
  weeklyTarget,
  streak,
  selectedType,
  pendingMinutes,
  pendingXp,
  onFocusSession,
  onSubmit,
  intro,
  clock,
}: {
  mission: DailyMission;
  weekSessions: number;
  weeklyTarget: number;
  streak: number;
  /** The chosen CARDIO_ACTIVITIES type, or null before anything is picked. */
  selectedType: string | null;
  /** The form's own live (mins, XP) preview, lifted so the CTA and the
   *  reward pill never disagree with what the form below would actually
   *  save. Zero before the athlete has entered anything. */
  pendingMinutes: number;
  pendingXp: number;
  /** Draws attention to the session card below (CHOOSE ACTIVITY / START
   *  SESSION / the post-MISSION-COMPLETE bonus-session case) — a glow pulse
   *  and a light haptic, never a scroll-jump the athlete didn't ask for. */
  onFocusSession: () => void;
  /** Fires the session form's OWN submit handler (registered via a ref —
   *  session-form.tsx's registerSubmit) — the one save path, never a copy. */
  onSubmit: () => void;
  intro: SharedValue<number>;
  clock: SharedValue<number>;
}) {
  const colors = useThemeColors();

  const headerStyle = useAnimatedStyle(() => ({ opacity: seg(intro.value, STAGE.header[0], STAGE.header[1]) }));
  const missionStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.mission[0], STAGE.mission[1]);
    return { opacity: p, transform: [{ translateY: (1 - p) * 10 }] };
  });
  const rewardsStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.rewards[0], STAGE.rewards[1]);
    return { opacity: p, transform: [{ translateY: (1 - p) * 8 }] };
  });
  const ctaStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.cta[0], STAGE.cta[1]);
    return { opacity: p, transform: [{ translateY: (1 - p) * 12 }], shadowOpacity: Math.sin(p * Math.PI) * 0.5 };
  });
  // THE BADGE BOB — a slow 2.5px rise and fall riding the page's own ambient
  // clock (never a driver of its own; useAmbient already gates `clock`
  // upstream in today.tsx, so a reduced-motion or perf-mode athlete sees it
  // sit still for free).
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.sin(clock.value * Math.PI * 2) * 2.5 }],
  }));

  const activity = selectedType ? activityFor(selectedType) : null;
  // A CONST, never `activity?.Icon`: the two independent optional chains
  // (one per read site below) left TypeScript unable to prove that a
  // truthy `activity` implies a defined `Icon` at each use — this single
  // binding is checked once and narrows cleanly everywhere it is read.
  const Icon = activity ? activity.Icon : PixelHeart;
  const complete = mission.complete;
  // The mission's WHOLE reward, if completed — deterministic from the target
  // alone (Train's xpReward does the same: it never changes with partial
  // progress, only the progress bar beside it does).
  const missionXp = cardioEventAmount(mission.target);

  let ctaTitle: string;
  let ctaSub: string;
  let ctaAction: () => void;
  let ctaVariant: 'primary' | 'ghost' = 'primary';
  if (complete && pendingMinutes <= 0) {
    ctaTitle = 'MISSION COMPLETE';
    ctaSub = 'Every extra minute still banks Forge XP.';
    ctaAction = onFocusSession;
    ctaVariant = 'ghost';
  } else if (pendingMinutes > 0) {
    ctaTitle = `LOG SESSION · +${pendingXp} XP`;
    ctaSub = `${activity?.label ?? 'Session'} · ${Math.trunc(pendingMinutes)} min ready to save`;
    ctaAction = onSubmit;
  } else if (selectedType) {
    ctaTitle = 'START SESSION';
    ctaSub = 'Enter your session details below.';
    ctaAction = onFocusSession;
  } else {
    ctaTitle = 'CHOOSE ACTIVITY';
    ctaSub = 'Pick what you did to start logging.';
    ctaAction = onFocusSession;
  }

  return (
    <GlowCard glow={complete ? colors.success : colors.accent} padding={16} testID="cardio-mission-card">
      {/* 1 — THE HEADER. */}
      <Animated.View
        style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, headerStyle]}
      >
        <Text
          className="text-epic"
          allowFontScaling={false}
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
        >
          ▮ TODAY&apos;S CONDITIONING MISSION
        </Text>
        {streak > 0 ? (
          <View
            className="flex-row items-center rounded-pill border px-s2"
            style={{ minHeight: 20, gap: 4, borderColor: `${colors.legendary}45`, backgroundColor: `${colors.legendary}12` }}
          >
            <PixelFlame size={11} color={colors.legendary} />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 9, letterSpacing: 0.5, color: colors.legendary, ...pixelFont(false) }}
              testID="cardio-mission-streak"
            >
              {streak} DAY{streak === 1 ? '' : 'S'}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      {/* 2 — THE BRIEFING, beside a compact conditioning badge. */}
      <View className="flex-row items-center" style={{ gap: 12, marginTop: 8 }}>
        <Animated.View style={[{ flex: 1, minWidth: 0 }, missionStyle]}>
          <Text
            className="text-text"
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling={false}
            style={{ fontSize: 22, lineHeight: 27, letterSpacing: 0, ...pixelFont() }}
          >
            {mission.target} MIN CARDIO
          </Text>
          <Text className="mt-s1 text-text-dim" numberOfLines={2} style={{ fontSize: 12, lineHeight: 16 }}>
            Build endurance, stamina &amp; conditioning
          </Text>
          {activity ? (
            <View className="mt-s2 flex-row items-center rounded-pill border px-s2 self-start" style={{ minHeight: 22, gap: 5, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}>
              <Icon size={11} color={colors.accent} />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{ fontSize: 10, letterSpacing: 0.4, color: colors.accent, ...pixelFont(false) }}
                testID="cardio-mission-activity"
              >
                {activity.label}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        <Animated.View
          style={[
            {
              width: 58,
              height: 58,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: `${complete ? colors.success : colors.accent}59`,
              backgroundColor: `${complete ? colors.success : colors.accent}12`,
              shadowColor: complete ? colors.success : colors.accent,
              shadowOpacity: 0.35,
              shadowRadius: 16,
            },
            badgeStyle,
          ]}
          testID="cardio-mission-badge"
        >
          <Icon size={26} color={complete ? colors.success : colors.accent} />
        </Animated.View>
      </View>

      {/* 3 — TODAY'S PROGRESS. */}
      <View className="mt-s3">
        <View className="flex-row items-center justify-between">
          <Label>TODAY&apos;S PROGRESS</Label>
          <Text
            className={complete ? 'text-success' : 'text-accent'}
            allowFontScaling={false}
            style={{ fontSize: 11, letterSpacing: 0, ...pixelFont() }}
            testID="cardio-mission-progress"
          >
            {mission.done} / {mission.target} MIN
          </Text>
        </View>
        <ProgressBar
          done={mission.done}
          total={mission.target}
          clock={clock}
          tint={complete ? colors.success : colors.accent}
          track={colors['surface-3']}
        />
      </View>

      {/* 4 — MISSION REWARDS. */}
      <Animated.View
        style={[
          {
            marginTop: 12,
            borderWidth: 1,
            borderRadius: 10,
            borderColor: `${colors.epic}30`,
            backgroundColor: 'rgba(168,85,247,0.05)',
            paddingHorizontal: 10,
            paddingVertical: 8,
          },
          rewardsStyle,
        ]}
        testID="cardio-mission-rewards"
      >
        <Text
          className="text-epic"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
        >
          ✦ MISSION REWARDS
        </Text>
        <View className="mt-s1 flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <RewardPill
            icon={<PixelBolt size={11} color={colors.legendary} />}
            label={`+${missionXp} XP`}
            tint={colors.legendary}
            size="lead"
            clock={intro}
            from={STAGE.rewards[0]}
            to={STAGE.rewards[1]}
            testID="cardio-mission-xp"
          />
        </View>
        <Text
          className="mt-s1"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.2, color: colors['text-mute'], ...pixelFont(false) }}
          testID="cardio-mission-benefit"
        >
          {'PRIMARY BENEFIT  '}
          <Text style={{ color: colors['text-dim'], ...pixelFont() }}>CONDITIONING</Text>
        </Text>
        <View className="mt-s1 flex-row items-center" style={{ gap: 6 }}>
          <PixelClock size={11} color={colors['text-dim']} />
          <Text className="text-2xs text-text-dim" testID="cardio-mission-week">
            {weekSessions} / {weeklyTarget} sessions this week
          </Text>
        </View>
      </Animated.View>

      {/* 5 — THE ONE DOOR. */}
      <Animated.View style={[{ marginTop: 10, shadowColor: colors.accent, shadowRadius: 30 }, ctaStyle]}>
        <NeonButton
          title={ctaTitle}
          pixel
          size="hero"
          variant={ctaVariant}
          sweep={ctaVariant === 'primary' && !complete}
          onPress={ctaAction}
          rightIcon={
            ctaVariant === 'primary' ? (
              <Text
                allowFontScaling={false}
                style={{ color: colors['accent-ink'], fontSize: 16, lineHeight: 16, marginTop: -2, fontWeight: '800' }}
              >
                ›
              </Text>
            ) : undefined
          }
          testID="cardio-mission-cta"
        />
        <Text className="mt-s2 text-center text-2xs text-text-mute" testID="cardio-mission-cta-hint">
          {ctaSub}
        </Text>
      </Animated.View>
    </GlowCard>
  );
}
