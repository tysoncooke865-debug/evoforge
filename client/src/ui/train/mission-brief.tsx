/**
 * THE MISSION BRIEF (2026-08-03, TRAIN brief) — "The page should feel like
 * beginning a mission. Not filling out a form."
 *
 * This is the Train hero card. It carries exactly the same data it always did
 * — the day's name, its muscles, its sets, its estimates, its progress and the
 * one door into logging — reordered into the briefing the brief asked for, and
 * with the two things the card never said out loud added:
 *
 *   MISSION OBJECTIVE   what this session is FOR (domain/mission-brief.ts —
 *                       derived from the muscles, so it is true whatever the
 *                       athlete named the day)
 *   MISSION REWARDS     what it pays, EVO FIRST
 *
 * ---- WHY THE EVO NUMBER IS REAL AND THE PILLAR DELTAS ARE NOT ----
 *
 * "+0.4 EVO" is the athlete's OWN measured rate (evo-per-session.ts: real
 * rating gain divided by the training days that produced it) and it DISAPPEARS
 * rather than defaulting when they have too little history to have a rate.
 * That is the same number, from the same module, that Home's mission card
 * shows — the two screens cannot disagree.
 *
 * The mock alongside the brief also showed "After this workout: Strength +0.3 ·
 * Size +0.2 · Evo +0.4". Those three do not exist and cannot: the rating is
 * recomputed from the whole evidence base at review time, so a single session's
 * contribution is path-dependent and unknowable in advance (the long-form
 * reason is in domain/progression/session-evidence.ts). What is true, from the
 * first session and without any history at all, is WHICH PILLARS the session
 * becomes evidence for — and that is the PRIMARY BENEFIT line.
 *
 * ---- THE ENTRANCE ----
 *
 * Five stages on ONE clock (train-scale.ts STAGE): header, mission, hologram,
 * rewards, CTA. 660ms end to end. Reduced motion pins every stage at rest and
 * fully visible — the entrance is decoration on top of a card that must be
 * readable the instant it exists.
 */

import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { Difficulty } from '@/domain/mission-brief';
import type { MapFocus, MuscleId, MuscleView } from '@/domain/muscle-map';
import { formatEvoEstimate } from '@/domain/progression/evo-per-session';
import { sessionStatus } from '@/domain/session-status';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { MissionLabel as Label, MissionProgressBar as ProgressBar } from '@/ui/core/mission-kit';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBolt, PixelClock, PixelTarget } from '@/ui/core/pixel-icons';
import { RewardPill } from '@/ui/core/reward-pill';
import { GlowCard } from '@/ui/core/shell';

import { MuscleHologram } from './muscle-hologram';
import { STAGE, useTrainScale } from './train-scale';

const MAX_CHIPS = 3;

/** 0 outside [a,b], 0→1 across it. Worklet-safe. */
const seg = (t: number, a: number, b: number): number => {
  'worklet';
  return Math.max(0, Math.min(1, (t - a) / (b - a)));
};

export interface MissionBriefData {
  workout: string;
  title: string;
  /** The plan's own qualifier ("Strength"), or the plan's name. */
  sub: string;
  objective: string | null;
  pills: string[];
  muscles: MuscleId[];
  difficulty: Difficulty | null;
  sets: number;
  minutes: number;
  done: number;
  finished: boolean;
}

export function MissionBriefCard({
  data,
  header,
  evoPerSession,
  xpReward,
  benefit,
  mapView,
  focus,
  onFlip,
  onMusclePress,
  onStart,
  onQuickWorkout,
  onTrainEarly,
  movedTo,
  onPutBack,
  isToday,
  intro,
  clock,
  testID,
  progressTestID,
  startTestID,
}: {
  data: MissionBriefData;
  /** The plan dropdown + date tag row — the caller owns both. */
  header: React.ReactNode;
  evoPerSession: number | null;
  xpReward: number;
  /** "STRENGTH & SIZE" — which Evo pillars the session is evidence for. */
  benefit: string | null;
  mapView: MuscleView;
  focus: MapFocus;
  onFlip: () => void;
  /** Opens the muscle board. `null` = opened from the figure or the `+N` chip,
   *  i.e. show everything; a MuscleId = opened from a named chip. */
  onMusclePress?: (muscle: MuscleId | null) => void;
  onStart: () => void;
  /**
   * QUICK WORKOUT (§1, 2026-08-10) — present on TODAY's card whenever there is
   * one, and never conditional on whether a session is planned.
   *
   * THE BUG THIS CLOSES: when a day resolved, this card was the whole hero and
   * it had exactly one door. Quick Workout existed only on the REST-DAY card
   * and two taps deep inside MANAGE PLAN — so on precisely the days an athlete
   * has a plan, "I want to do something else today" was the hardest thing in
   * the app to say. The plan is a recommendation, not a lock.
   *
   * WHY IT SITS BESIDE THE CTA AND NOT UNDER IT. The brief sketches them
   * stacked, and stacking is ~26pt this card does not have: the height is a
   * fixed, device-MEASURED budget (train-scale.ts) in which START WORKOUT
   * clears the iPhone SE fold by about three points. A second row would push
   * the primary action under the fold on the smallest tier — trading a
   * discoverability problem for a worse one. Side by side costs nothing,
   * and START keeps the glow, the sweep, the hero size and ~70% of the width,
   * so "visually dominant" survives intact.
   */
  onQuickWorkout?: () => void;
  /**
   * TRAIN EARLY (§2) — on a FUTURE card, the CTA becomes this. `plannedFor`
   * is the date it was scheduled for, so the helper line can say when.
   */
  onTrainEarly?: () => void;
  /** Set when this future session has already been trained early; the card
   *  reports where it went and offers the one-tap undo. */
  movedTo?: string | null;
  onPutBack?: () => void;
  isToday: boolean;
  intro: SharedValue<number>;
  clock: SharedValue<number>;
  testID: string;
  progressTestID: string;
  startTestID: string;
}) {
  const colors = useThemeColors();
  const scale = useTrainScale();

  const headerStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.header[0], STAGE.header[1]);
    return { opacity: p };
  });
  const missionStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.mission[0], STAGE.mission[1]);
    return { opacity: p, transform: [{ translateY: (1 - p) * 10 }] };
  });
  const rewardsStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.rewards[0], STAGE.rewards[1]);
    return { opacity: p, transform: [{ translateY: (1 - p) * 8 }] };
  });
  // "Start Workout glows": it arrives last, rising, and its shadow blooms past
  // its resting value before settling — a light coming up, not a fade-in.
  const ctaStyle = useAnimatedStyle(() => {
    const p = seg(intro.value, STAGE.cta[0], STAGE.cta[1]);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 12 }],
      shadowOpacity: Math.sin(p * Math.PI) * 0.5,
    };
  });

  const chips = [
    ...data.pills.slice(0, MAX_CHIPS),
    ...(data.pills.length > MAX_CHIPS ? [`+${data.pills.length - MAX_CHIPS}`] : []),
  ];
  /**
   * THE DOOR, in four states. `moved` outranks everything: a session already
   * trained early is not startable again from its original day — offering
   * START there is how a duplicate session gets created, which §29 names as
   * the thing that would make "train early" fake.
   */
  const moved = Boolean(movedTo);
  /**
   * READY TO FINISH (2026-08-11). `data.done >= data.sets` with no finish
   * marker means every planned set is in and the only thing left is the
   * button — so it must SAY so. Home offered RESUME beside "17/17 SETS
   * COMPLETED" and Train offered CONTINUE; both are the same omission, and
   * both now read from the canonical status (domain/session-status.ts).
   */
  const canonical = sessionStatus({
    workout: data.workout,
    targetSets: data.sets,
    doneSets: data.done,
    finished: data.finished,
  });
  const buttonTitle = moved
    ? 'TRAINED EARLY'
    : onTrainEarly
      ? 'TRAIN EARLY'
      : canonical === 'completed'
        ? 'VIEW WORKOUT'
        : canonical === 'ready_to_finish'
          ? 'FINISH WORKOUT'
          : canonical === 'in_progress'
            ? 'CONTINUE WORKOUT'
            : 'START WORKOUT';
  const showProgress = data.done > 0 && data.sets > 0;

  return (
    <View style={{ height: scale.cardHeight, paddingHorizontal: 2 }}>
      <GlowCard glow={colors.accent} padding={14} fill>
        <View testID={testID} style={{ flex: 1 }}>
          {/* 1 — THE HEADER. */}
          <Animated.View
            style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, headerStyle]}
          >
            {header}
          </Animated.View>

          {/* 2 — THE BRIEFING, beside the readout of the body it acts on. */}
          <View className="flex-row" style={{ gap: 10, flex: 1 }}>
            <Animated.View style={[{ flex: 1, minWidth: 0, justifyContent: 'center' }, missionStyle]}>
              <Text
                className="text-epic"
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
              >
                ▮ TODAY&apos;S MISSION
              </Text>
              <Text
                className="text-text"
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
                style={{
                  marginTop: 2,
                  fontSize: scale.title,
                  lineHeight: Math.round(scale.title * 1.22),
                  letterSpacing: 0,
                  ...pixelFont(),
                }}
              >
                {data.title.toUpperCase()}
              </Text>

              {/* MISSION OBJECTIVE — why today exists. TWO lines: at one it
                  truncated to "Build pressing power & up…" on a 390pt phone,
                  and half an objective is worse than none. */}
              {data.objective ? (
                <View className="mt-s1 flex-row items-start" style={{ gap: 5 }}>
                  <View style={{ paddingTop: 2 }}>
                    <PixelTarget size={12} color={colors.accent} />
                  </View>
                  <Text
                    className="text-text-dim"
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    style={{ fontSize: scale.objective, lineHeight: Math.round(scale.objective * 1.35), flexShrink: 1 }}
                    testID="mission-objective"
                  >
                    {data.objective}
                  </Text>
                </View>
              ) : (
                <Text className="mt-s1 text-text-dim" numberOfLines={1} style={{ fontSize: scale.objective }} testID="hero-sub">
                  {data.sub}
                </Text>
              )}

              {/* PRIMARY MUSCLES — labelled, so the chips read as an answer to
                  a question rather than as loose decoration.
                  EACH CHIP IS A DOOR (2026-08-03). The figure beside them is
                  130pt wide, which makes an individual muscle on it a ~4mm
                  target; these are already a labelled list of exactly the
                  regions the day hits, so they became the reliable way in and
                  a hitSlop takes them past the 44pt floor without costing the
                  card a single point of height. The `+N` chip opens the board
                  with nothing pre-selected — it means "and more", so it cannot
                  name one. */}
              {chips.length > 0 ? (
                <View className="mt-s3">
                  <Label>PRIMARY MUSCLES</Label>
                  <View className="mt-s1 flex-row flex-wrap" style={{ gap: 5 }}>
                    {chips.map((p, i) => {
                      const muscle = data.muscles[i] ?? null;
                      const overflow = i >= MAX_CHIPS;
                      return (
                        <Pressable
                          key={p}
                          onPress={onMusclePress ? () => onMusclePress(overflow ? null : muscle) : undefined}
                          disabled={onMusclePress === undefined}
                          accessibilityRole={onMusclePress ? 'button' : undefined}
                          accessibilityLabel={overflow ? 'show all muscles' : `${p} load`}
                          hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
                          testID={overflow ? 'muscle-chip-more' : `muscle-chip-${muscle ?? p}`}
                          className="flex-row items-center rounded-pill border px-s2"
                          style={{
                            minHeight: 22,
                            gap: 4,
                            borderColor: onMusclePress ? `${colors.accent}59` : `${colors.accent}33`,
                            backgroundColor: 'rgba(34,211,238,0.06)',
                          }}
                        >
                          <Text
                            className="text-center text-text-dim"
                            numberOfLines={1}
                            allowFontScaling={false}
                            style={{ fontSize: 10, letterSpacing: 0.4, ...pixelFont(false) }}
                          >
                            {p}
                          </Text>
                          {/* The one pixel that says "this opens something". */}
                          {onMusclePress ? (
                            <View style={{ width: 3, height: 3, backgroundColor: colors.accent, opacity: 0.9 }} />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* DIFFICULTY · EST. TIME. */}
              <View className="mt-s3 flex-row" style={{ gap: 16 }}>
                {data.difficulty ? (
                  <View>
                    <Label>DIFFICULTY</Label>
                    <View className="mt-s1 flex-row items-center" style={{ gap: 6 }}>
                      <Text
                        className="text-text"
                        allowFontScaling={false}
                        style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}
                        testID="mission-difficulty"
                      >
                        {data.difficulty.label}
                      </Text>
                      <SignalBars filled={data.difficulty.bars} colour={colors.accent} />
                    </View>
                  </View>
                ) : null}
                {data.minutes > 0 ? (
                  <View>
                    <Label>EST. TIME</Label>
                    <View className="mt-s1 flex-row items-center" style={{ gap: 5 }}>
                      <PixelClock size={12} color={colors['text-dim']} />
                      <Text
                        className="text-text"
                        allowFontScaling={false}
                        style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}
                        testID="mission-time"
                      >
                        {data.minutes} MIN
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </Animated.View>

            <MuscleHologram
              muscles={data.muscles}
              view={mapView}
              focus={focus}
              width={scale.figureWidth}
              height={scale.mapHeight}
              alive={isToday}
              intro={intro}
              clock={clock}
              onFlip={onFlip}
              onOpen={onMusclePress ? () => onMusclePress(null) : undefined}
            />
          </View>

          {/* 3 — MISSION REWARDS. Pinned to the bottom of the flexible area so
              it and the CTA sit at the same height on every card. */}
          <Animated.View
            style={[
              {
                marginTop: 'auto',
                borderWidth: 1,
                borderRadius: 10,
                borderColor: `${colors.epic}30`,
                backgroundColor: 'rgba(168,85,247,0.05)',
                paddingHorizontal: 10,
                paddingVertical: 8,
              },
              rewardsStyle,
            ]}
            testID="mission-rewards"
          >
            <Text
              className="text-epic"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
            >
              ✦ MISSION REWARDS
            </Text>
            <View className="mt-s1 flex-row flex-wrap items-center" style={{ gap: 8 }}>
              {evoPerSession !== null ? (
                <RewardPill
                  label={`◈ ${formatEvoEstimate(evoPerSession)} EVO`}
                  tint={colors.epic}
                  size="lead"
                  clock={intro}
                  from={STAGE.rewards[0]}
                  to={STAGE.rewards[1]}
                  testID="mission-evo-gain"
                />
              ) : null}
              {xpReward > 0 ? (
                <RewardPill
                  icon={<PixelBolt size={11} color={colors.legendary} />}
                  label={`+${xpReward} XP`}
                  tint={colors.legendary}
                  clock={intro}
                  from={STAGE.rewards[0] + 0.06}
                  to={STAGE.rewards[1] + 0.06}
                  testID="mission-xp"
                />
              ) : null}
            </View>
            {/* 4 — PROGRESS *REPLACES* THE BENEFIT LINE once there is some.
                They are the same one line of the block, and that is deliberate:
                before you start, what the session BUYS is the thing worth
                knowing; once you are eight sets in, how far you have to go is.
                Showing both would have cost a line the compact card does not
                have, and an empty bar under a zero is furniture, not
                information. */}
            {showProgress ? (
              <View className="mt-s1">
                <View className="flex-row items-center justify-between">
                  <Label>TODAY&apos;S PROGRESS</Label>
                  <Text
                    className="text-accent"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 0, ...pixelFont() }}
                    testID={progressTestID}
                  >
                    {data.done} / {data.sets} SETS
                  </Text>
                </View>
                <ProgressBar done={data.done} total={data.sets} clock={clock} tint={colors.accent} track={colors['surface-3']} />
              </View>
            ) : benefit ? (
              <Text
                className="mt-s1"
                numberOfLines={1}
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1.2, color: colors['text-mute'], ...pixelFont(false) }}
                testID="mission-benefit"
              >
                {'PRIMARY BENEFIT  '}
                <Text style={{ color: colors['text-dim'], ...pixelFont() }}>{benefit}</Text>
              </Text>
            ) : null}
          </Animated.View>

          {/* 5 — THE DOOR. Still ONE dominant door; the secondary beside it is
              deliberately quiet (ghost, no glow, no sweep, ~30% width) and
              exists because "the plan is a recommendation, not a lock". */}
          <Animated.View
            style={[
              { marginTop: 10, flexDirection: 'row', alignItems: 'stretch', gap: 8, shadowColor: colors.accent, shadowRadius: 30 },
              ctaStyle,
            ]}
          >
            <View style={{ flex: 1 }}>
              <NeonButton
                title={buttonTitle}
                pixel
                size="hero"
                sweep={isToday && !data.finished}
                disabled={moved}
                onPress={moved ? () => undefined : (onTrainEarly ?? onStart)}
                rightIcon={
                  moved ? undefined : (
                    <Text
                      allowFontScaling={false}
                      style={{ color: colors['accent-ink'], fontSize: 16, lineHeight: 16, marginTop: -2, fontWeight: '800' }}
                    >
                      ›
                    </Text>
                  )
                }
                testID={startTestID}
              />
            </View>
            {onQuickWorkout && !moved ? (
              <Pressable
                onPress={onQuickWorkout}
                accessibilityRole="button"
                accessibilityLabel="start a quick workout instead"
                testID="hero-quick-workout"
                className="items-center justify-center rounded-md border px-s3"
                style={{
                  minWidth: 88,
                  borderColor: `${colors.accent}59`,
                  backgroundColor: 'rgba(34,211,238,0.07)',
                }}
              >
                <Text
                  className="text-2xs text-accent"
                  allowFontScaling={false}
                  numberOfLines={2}
                  style={{ letterSpacing: 0, textAlign: 'center', ...pixelFont() }}
                >
                  QUICK{'\n'}WORKOUT
                </Text>
              </Pressable>
            ) : null}
            {moved && onPutBack ? (
              <Pressable
                onPress={onPutBack}
                accessibilityRole="button"
                accessibilityLabel="put this session back on its scheduled day"
                testID="hero-put-back"
                className="items-center justify-center rounded-md border px-s3"
                style={{ minWidth: 88, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.07)' }}
              >
                <Text
                  className="text-2xs text-accent"
                  allowFontScaling={false}
                  numberOfLines={2}
                  style={{ letterSpacing: 0, textAlign: 'center', ...pixelFont() }}
                >
                  PUT IT{'\n'}BACK
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>

          {/* §2: "Avoid unnecessary warning modals." One quiet line instead. */}
          {onTrainEarly || moved ? (
            <Text
              className="mt-s1 text-center text-2xs text-text-mute"
              numberOfLines={1}
              allowFontScaling={false}
              testID="hero-early-hint"
            >
              {moved ? `Trained on ${movedTo}` : 'Your plan adapts around when you actually train.'}
            </Text>
          ) : null}
        </View>
      </GlowCard>
    </View>
  );
}

/** Four rising bars; `filled` of them lit. Colour is never the only cue —
 *  the word ("NORMAL") sits beside it. */
function SignalBars({ filled, colour }: { filled: number; colour: string }) {
  return (
    <View className="flex-row items-end" style={{ gap: 2 }}>
      {[3, 5, 7, 9].map((h, i) => (
        <View
          key={h}
          style={{
            width: 3,
            height: h,
            backgroundColor: i < filled ? colour : 'rgba(148,163,184,0.28)',
            shadowColor: colour,
            shadowOpacity: i < filled ? 0.7 : 0,
            shadowRadius: 4,
          }}
        />
      ))}
    </View>
  );
}
