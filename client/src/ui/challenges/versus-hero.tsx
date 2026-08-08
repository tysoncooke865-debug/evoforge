import { useEffect } from 'react';
import { Image, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Branch } from '@/domain/avatar-stats';
import type { Confidence } from '@/domain/challenge-progression';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Silhouette } from '@/ui/character/silhouette';
import { LeadStrip, ScoreBar } from '@/ui/duel/duel-score-meter';

/**
 * THE DUEL, as a picture.
 *
 * Two champions facing each other, the scores under them, and a confidence
 * band between. Everything an athlete needs in three seconds: who, what it
 * stands at, and whether they are winning.
 *
 * THE OPPONENT IS A SILHOUETTE, AND THAT IS NOT A PLACEHOLDER. EvoForge does
 * not publish another athlete's champion — their Origin, form and art are
 * theirs. A rimmed silhouette is the honest render of "someone real, whose
 * character you have not been shown", and it happens to read exactly like the
 * shrouded opponent of a fighting game. Inventing art for them would leak a
 * choice they never made public.
 *
 * NO COUNTDOWN, DELIBERATELY. A Forge Challenge runs for 7 or 14 days; a
 * "3… 2… 1… FIGHT" before a fortnight of training would be theatre for a
 * moment that does not exist. The tension here is a live scoreline that moves
 * when either athlete trains, which is the real thing.
 */
export function VersusHero({
  myName,
  myScore,
  mySource,
  theirName,
  theirScore,
  theirBranch,
  theirStage,
  unit,
  confidence,
  live,
  myFill = 0,
  theirFill = 0,
  gapLabel = null,
  leaderId = null,
  myId = '',
  testID,
}: {
  myName: string;
  myScore: string;
  mySource: ImageSourcePropType | null;
  theirName: string;
  theirScore: string;
  theirBranch: Branch;
  theirStage: number;
  unit: string;
  confidence: Confidence;
  /** A finished contest stops breathing — the moment has passed. */
  live: boolean;
  /** 144: each side's rail, normalised against the leader (0..1). The number
   *  above it is the fact; the rail is the shape of the gap. */
  myFill?: number;
  theirFill?: number;
  /** The numeric gap, formatted with its unit. Null when level. */
  gapLabel?: string | null;
  /** Who the SERVER says is ahead — the source of the lead-change moment. */
  leaderId?: string | null;
  myId?: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();

  // ONE driver for both auras and the spark between them.
  const beat = useSharedValue(0);
  useEffect(() => {
    if (reduced || !live) {
      beat.value = 0;
      return;
    }
    beat.value = 0;
    beat.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1);
  }, [reduced, live, beat]);

  const leading = confidence.band === 'commanding' || confidence.band === 'ahead';
  const losing = confidence.band === 'chasing' || confidence.band === 'behind';

  const vsStyle = useAnimatedStyle(() => {
    if (reduced || !live) return { opacity: 0.75, transform: [{ scale: 1 }] };
    const wave = (1 - Math.cos(beat.value * Math.PI * 2)) / 2;
    return { opacity: 0.6 + wave * 0.4, transform: [{ scale: 1 + wave * 0.06 }] };
  });

  return (
    <View testID={testID}>
      <View className="flex-row items-end" style={{ gap: 6 }}>
        <Fighter
          name={myName}
          score={myScore}
          unit={unit}
          tint={colors.accent}
          beat={beat}
          phase={0}
          strong={leading}
          calm={reduced || !live}
          highlight={leading}
          fill={myFill}
          art={
            mySource ? (
              <Image
                source={mySource}
                style={{ width: 76, height: 92, resizeMode: 'contain' }}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Silhouette
                branch={theirBranch}
                stage={theirStage}
                width={76}
                height={92}
                rim={colors.accent}
                tint="#4b6584"
                wash={0.15}
              />
            )
          }
          testID="versus-me"
        />

        <View className="items-center" style={{ paddingBottom: 26 }}>
          <Animated.Text
            allowFontScaling={false}
            style={[
              { fontSize: 15, letterSpacing: 1, color: colors['text-mute'], ...pixelFont() },
              vsStyle,
            ]}
          >
            VS
          </Animated.Text>
        </View>

        <Fighter
          name={theirName}
          score={theirScore}
          unit={unit}
          tint={colors.danger}
          beat={beat}
          phase={0.5}
          strong={losing}
          calm={reduced || !live}
          highlight={losing}
          fill={theirFill}
          // Always a silhouette: another athlete's champion is not ours to show.
          art={
            <Silhouette
              branch={theirBranch}
              stage={theirStage}
              width={76}
              height={92}
              rim={colors.danger}
              tint="#5a4a5e"
              wash={0.15}
            />
          }
          mirrored
          testID="versus-them"
        />
      </View>

      {/* THE BAND — never a percentage-to-win. A contest decided by future
          training has no honest probability, and a fake one would deserve to
          be disbelieved. What IS honest is the current gap, so the words carry
          the feeling and the number beside them carries the fact. Owned by
          LeadStrip since 144, which also owns the lead-change moment. */}
      <LeadStrip
        confidence={confidence}
        gapLabel={gapLabel}
        leaderId={leaderId}
        myId={myId}
        live={live}
        testID="versus-confidence"
      />
    </View>
  );
}

function Fighter({
  name,
  score,
  unit,
  tint,
  beat,
  phase,
  strong,
  calm,
  highlight,
  fill,
  art,
  mirrored,
  testID,
}: {
  name: string;
  score: string;
  unit: string;
  tint: string;
  /** The SHARED driver, not a computed style — a Reanimated style threaded
   *  across a component boundary is a type fight and a re-render risk. */
  beat: { value: number };
  /** Offsets this fighter's breath so the two auras never pulse in lockstep. */
  phase: number;
  /** The one who is ahead (or behind, on their side) breathes harder — the
   *  fastest read of who is winning, before any number is parsed. */
  strong: boolean;
  /** Reduced motion, or a finished contest: hold it still. */
  calm: boolean;
  highlight: boolean;
  /** This side's rail, normalised against the leader (0..1). */
  fill: number;
  art: React.ReactNode;
  mirrored?: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  const aura = useAnimatedStyle(() => {
    if (calm) return { opacity: strong ? 0.3 : 0.14 };
    const wave = (1 - Math.cos((beat.value + phase) * Math.PI * 2)) / 2;
    const base = strong ? 0.22 : 0.1;
    return { opacity: base + wave * (strong ? 0.3 : 0.12) };
  });
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }} testID={testID}>
      <View style={{ width: 76, height: 92, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: -10,
              right: -10,
              top: 4,
              bottom: -4,
              borderRadius: 48,
              backgroundColor: tint,
            },
            aura,
          ]}
        />
        {/* THEY FACE EACH OTHER. The right-hand champion is mirrored, which is
            what turns two portraits into a confrontation. */}
        <View style={mirrored ? { transform: [{ scaleX: -1 }] } : undefined}>{art}</View>
      </View>
      <Text
        className="mt-s1 text-text-dim"
        numberOfLines={1}
        style={{ fontSize: 10, maxWidth: 110 }}
      >
        {name}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{
          fontSize: 20,
          letterSpacing: 0,
          color: highlight ? tint : colors.text,
          ...pixelFont(),
        }}
      >
        {score}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 7, letterSpacing: 1, ...pixelFont(false) }}
      >
        {unit.toUpperCase()}
      </Text>
      {/* THE RAIL. Normalised against whoever is ahead, so the leader's is
          always full and the gap is a shape rather than a subtraction. */}
      <ScoreBar fill={fill} tint={tint} lead={highlight} testID={`${testID}-bar`} />
    </View>
  );
}
