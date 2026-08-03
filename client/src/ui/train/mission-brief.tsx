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

import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { Difficulty } from '@/domain/mission-brief';
import type { MapFocus, MuscleId, MuscleView } from '@/domain/muscle-map';
import { formatEvoEstimate } from '@/domain/progression/evo-per-session';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
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
  onMusclePress?: (muscle: MuscleId) => void;
  onStart: () => void;
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
  const buttonTitle = data.finished ? 'VIEW WORKOUT' : data.done > 0 ? 'CONTINUE WORKOUT' : 'START WORKOUT';
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
                  a question rather than as loose decoration. */}
              {chips.length > 0 ? (
                <View className="mt-s3">
                  <Label>PRIMARY MUSCLES</Label>
                  <View className="mt-s1 flex-row flex-wrap" style={{ gap: 5 }}>
                    {chips.map((p) => (
                      <View
                        key={p}
                        className="rounded-pill border px-s2"
                        style={{
                          minHeight: 22,
                          justifyContent: 'center',
                          borderColor: `${colors.accent}33`,
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
                      </View>
                    ))}
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
              onMusclePress={onMusclePress}
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

          {/* 5 — THE ONE DOOR. Nothing on this card may compete with it. */}
          <Animated.View
            style={[{ marginTop: 10, shadowColor: colors.accent, shadowRadius: 30 }, ctaStyle]}
          >
            <NeonButton
              title={buttonTitle}
              pixel
              size="hero"
              sweep={isToday && !data.finished}
              onPress={onStart}
              rightIcon={
                <Text
                  allowFontScaling={false}
                  style={{ color: colors['accent-ink'], fontSize: 16, lineHeight: 16, marginTop: -2, fontWeight: '800' }}
                >
                  ›
                </Text>
              }
              testID={startTestID}
            />
          </Animated.View>
        </View>
      </GlowCard>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{ fontSize: 8.5, letterSpacing: 1.6, color: colors['text-mute'], ...pixelFont(false) }}
    >
      {children}
    </Text>
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

/**
 * The fill, with a shimmer travelling along it. The shimmer rides the page's
 * ambient clock rather than one of its own — the brief asks for "progress bars
 * shimmer" everywhere, and everywhere is where a per-bar loop becomes a real
 * frame cost on web (every Reanimated loop runs on the main JS thread there).
 */
function ProgressBar({
  done,
  total,
  clock,
  tint,
  track,
}: {
  done: number;
  total: number;
  clock: SharedValue<number>;
  tint: string;
  track: string;
}) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const shimmer = useAnimatedStyle(() => {
    const p = clock.value / 0.34;
    if (p > 1) return { opacity: 0, transform: [{ translateX: -60 }] };
    return { opacity: Math.sin(p * Math.PI) * 0.75, transform: [{ translateX: -60 + p * 320 }] };
  });
  return (
    <View
      className="mt-s1 self-stretch overflow-hidden rounded-pill"
      style={{ height: 6, backgroundColor: track }}
    >
      <View
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 999,
          backgroundColor: tint,
          overflow: 'hidden',
          shadowColor: tint,
          shadowOpacity: 0.6,
          shadowRadius: 8,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, bottom: 0, width: 44, backgroundColor: 'rgba(255,255,255,0.5)' },
            shimmer,
          ]}
        />
      </View>
    </View>
  );
}
