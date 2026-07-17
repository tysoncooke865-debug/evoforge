import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useCardioLog, useLatestMeasurements, usePhysiqueRatings } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { branchDisplayNameV2, branchPathsV2, type BranchV2, massArtStage } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { getBranchStage } from '@/domain/avatar-stats';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { animatedAvatar, avatarArtV2 } from '@/ui/character/avatar-art';
import { Silhouette } from '@/ui/character/silhouette';

/**
 * The PATHS subview (was "skill tree"; P6 renamed the label, not the
 * engine): individual attributes as progress nodes, each
 * path flowing into the branch(es) it feeds. Reads ONLY what the app
 * already tracks — a node with no data source says so honestly instead of
 * inventing a number. Branch destination states come from branchPathsV2 +
 * evolutionReadiness, the same engine Evolution uses; nothing here changes
 * branch rules.
 */

// ---------------------------------------------------------------- data

interface SkillNodeData {
  key: string;
  name: string;
  /** Shorter label for the tight grid cell; the sheet uses the full name. */
  short?: string;
  /** null = not tracked yet. */
  current: number | null;
  target: number;
  unit: string;
  /** 0..1, already clamped; null when untracked. */
  pct: number | null;
  how: string;
  nextAction: string;
  untrackedHint?: string;
}

interface SkillPathData {
  key: string;
  name: string;
  eyebrow: string;
  abbr: string;
  tint: string;
  nodes: SkillNodeData[];
  /** Mean of tracked node percentages, 0..100. */
  percent: number;
  destinations: BranchV2[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function node(
  key: string,
  name: string,
  current: number | null,
  target: number,
  unit: string,
  how: string,
  nextAction: string,
  untrackedHint?: string
): SkillNodeData {
  return {
    key,
    name,
    current,
    target,
    unit,
    pct: current === null ? null : clamp01(current / target),
    how,
    nextAction,
    untrackedHint,
  };
}

export function useSkillTree(): { paths: SkillPathData[]; branchState: (b: BranchV2) => DestinationState } {
  const colors = useThemeColors();
  const { stats, bfMid, earliestBf, nutritionPhase, branchV2 } = useAvatarData();
  const cardio = useCardioLog();
  const tape = useLatestMeasurements();
  const physique = usePhysiqueRatings();

  const paths = useMemo<SkillPathData[]>(() => {
    const bw = stats.bodyweight;

    // Cumulative cardio per modality, from the real log.
    let runKm = 0;
    let bikeKm = 0;
    let stairMin = 0;
    let boxSessions = 0;
    for (const row of cardio.data ?? []) {
      const r = row as Record<string, unknown>;
      const type = String(r.type ?? '');
      const km = pyFloat(r.distance_km) ?? 0;
      const min = pyFloat(r.minutes) ?? 0;
      if (type === 'Run') runKm += Math.max(0, km);
      else if (type === 'Bike') bikeKm += Math.max(0, km);
      else if (type === 'Stairmaster') stairMin += Math.max(0, min);
      else if (type === 'Boxing') boxSessions += 1;
    }

    const m = tape.data ?? {};
    const shoulders = m.shoulders_cm ?? null;
    const waist = m.waist_cm ?? null;
    const taper = shoulders !== null && waist !== null && waist > 0 ? shoulders / waist : null;
    const symmetry = physique.data?.symmetry_score ?? null;
    const startBf = earliestBf !== null && earliestBf > 0 ? earliestBf : null;
    const cutProgress =
      bfMid !== null && startBf !== null && startBf > 12
        ? clamp01((startBf - bfMid) / (startBf - 12))
        : null;

    // Lift targets ride the standards curve's ADVANCED anchors — the same
    // scale that grades the strength stat, so the tree never contradicts it.
    const strength: SkillPathData = {
      key: 'strength',
      name: 'STRENGTH',
      eyebrow: 'IRON PATH',
      abbr: 'STR',
      tint: colors.accent,
      destinations: ['titan', 'mass'],
      nodes: [
        node('bench', 'Bench Press', round1(stats.benchE1rm) || null, round1(1.75 * bw), 'kg',
          'Best estimated 1RM across every logged bench set (Epley), against the advanced standard of 1.75× bodyweight.',
          'Log heavier or higher-rep bench sets on Today.'),
        node('squat', 'Squat', round1(stats.squatE1rm) || null, round1(2.0 * bw), 'kg',
          'Best estimated 1RM across every logged squat set, against the advanced standard of 2.0× bodyweight.',
          'Log heavier or higher-rep squat sets on Today.'),
        node('deadlift', 'Deadlift', round1(stats.deadliftE1rm) || null, round1(2.25 * bw), 'kg',
          'Your onboarding deadlift e1RM (or logged barbell deadlifts), against the advanced standard of 2.25× bodyweight.',
          'Update your deadlift e1RM in your profile, or log barbell deadlifts.',
          'Set your deadlift e1RM in Profile to light this node.'),
        { ...node('ohp', 'Military Press', null, 1, '',
          'Overhead pressing is not in the exercise catalog yet.',
          'This node lights up when overhead presses join the catalog.',
          'No overhead press in the exercise catalog yet.'), short: 'MIL PRESS' },
      ],
      percent: 0,
    };

    const conditioning: SkillPathData = {
      key: 'conditioning',
      name: 'CONDITIONING',
      eyebrow: 'ENDURANCE PATH',
      abbr: 'CND',
      tint: colors.rare,
      destinations: ['cardio'],
      nodes: [
        node('run', 'Run', round1(runKm) || (runKm > 0 ? runKm : null), 50, 'km total',
          'Every kilometre from logged Run sessions, toward a 50 km lifetime milestone.',
          'Log a run on the Log tab.',
          'Log your first run to light this node.'),
        node('ride', 'Ride', round1(bikeKm) || (bikeKm > 0 ? bikeKm : null), 100, 'km total',
          'Every kilometre from logged Bike sessions, toward a 100 km milestone.',
          'Log a ride on the Log tab.',
          'Log your first ride to light this node.'),
        node('climb', 'Climb', stairMin > 0 ? Math.trunc(stairMin) : null, 300, 'min total',
          'Every Stairmaster minute, toward a 300-minute milestone.',
          'Log a Stairmaster session on the Log tab.',
          'Log your first Stairmaster session to light this node.'),
        node('boxing', 'Boxing', boxSessions > 0 ? boxSessions : null, 30, 'sessions',
          'Every logged Boxing session, toward 30 rounds-nights.',
          'Log a boxing session on the Log tab.',
          'Log your first boxing session to light this node.'),
      ],
      percent: 0,
    };

    const size: SkillPathData = {
      key: 'size',
      name: 'SIZE',
      eyebrow: 'MASS PATH',
      abbr: 'SIZ',
      tint: colors.epic,
      destinations: ['mass', 'titan'],
      nodes: [
        node('bw', 'Bodyweight', round1(bw) || null, 88, 'kg',
          'Latest bodyweight reading, against the 88 kg top of the frame scale the size stat uses.',
          'Log bodyweight on the Log tab.'),
        node('chest', 'Chest', m.chest_cm ?? null, 110, 'cm',
          'Latest chest tape measurement, toward 110 cm.',
          'Tape your chest under Log → measurements.',
          'Tape your chest to light this node.'),
        node('arms', 'Arms', m.bicep_cm ?? null, 45, 'cm',
          'Latest bicep tape measurement, toward 45 cm.',
          'Tape your bicep under Log → measurements.',
          'Tape your bicep to light this node.'),
        node('shoulders', 'Shoulders', shoulders, 130, 'cm',
          'Latest shoulder tape measurement, toward 130 cm.',
          'Tape your shoulders under Log → measurements.',
          'Tape your shoulders to light this node.'),
      ],
      percent: 0,
    };

    const aesthetic: SkillPathData = {
      key: 'aesthetic',
      name: 'AESTHETIC',
      eyebrow: 'PHYSIQUE PATH',
      abbr: 'AES',
      tint: colors.mythic,
      destinations: ['aesthetic'],
      nodes: [
        node('taper', 'V-Taper', taper !== null ? round2(taper) : null, 1.62, 'shoulder:waist',
          'Shoulder circumference over waist, toward the 1.618 golden ratio.',
          'Tape shoulders and waist under Log → measurements.',
          'Tape shoulders and waist to light this node.'),
        node('symmetry', 'Symmetry', symmetry, 15, '/15',
          "The Oracle's symmetry verdict from your latest physique scan.",
          'Run an AI physique scan on the AI tab.',
          'Run an AI physique scan to light this node.'),
        node('neck', 'Neck', m.neck_cm ?? null, 40, 'cm',
          'Latest neck tape measurement, toward 40 cm.',
          'Tape your neck under Log → measurements.',
          'Tape your neck to light this node.'),
        node('aes-score', 'Aesthetic Score', stats.aestheticScore, 100, '/100',
          'The blended aesthetic stat: leanness, size, symmetry and the AI physique verdict.',
          'Improve leanness and symmetry — the blend follows.'),
      ],
      percent: 0,
    };

    const leanness: SkillPathData = {
      key: 'leanness',
      name: 'LEANNESS',
      eyebrow: 'SHREDDED PATH',
      abbr: 'LEN',
      tint: colors.success,
      destinations: ['shredder'],
      nodes: [
        node('bf', 'Body Fat', bfMid !== null ? round1(bfMid) : null, 12, '% (target ≤)',
          'Latest body-fat estimate; the Shredder line resolves at 12%.',
          'Run an AI body-fat scan on the AI tab.',
          'Run an AI body-fat scan to light this node.'),
        node('cut', 'The Cut', cutProgress !== null ? Math.round(cutProgress * 100) : null, 100, '% of journey',
          'Distance travelled from your first body-fat reading down to 12%.',
          'Keep the phase honest and the scans coming.',
          'Needs a first body-fat reading to measure from.'),
        node('lean-score', 'Leanness Score', stats.leannessScore, 100, '/100',
          'The leanness stat: 100 at 8% body fat, falling 6.5 points per point of body fat.',
          'Drop body fat; the score follows the tape.'),
        node('phase', 'Cutting Phase', nutritionPhase === 'cutting' ? 1 : nutritionPhase ? 0 : null, 1, '',
          'Whether your profile phase is set to cutting — the Shredder entry gate reads it.',
          'Set your nutrition phase in your profile.',
          'Set a nutrition phase in your profile to light this node.'),
      ],
      percent: 0,
    };

    // Body-fat progress reads INVERTED (lower is better); patch its pct.
    const bfNode = leanness.nodes[0];
    if (bfNode.current !== null && startBf !== null) {
      bfNode.pct = cutProgress;
    }

    for (const p of [strength, conditioning, size, aesthetic, leanness]) {
      const tracked = p.nodes.filter((n) => n.pct !== null);
      p.percent =
        tracked.length > 0
          ? Math.round((tracked.reduce((acc, n) => acc + (n.pct ?? 0), 0) / tracked.length) * 100)
          : 0;
    }
    return [strength, conditioning, size, aesthetic, leanness];
  }, [stats, cardio.data, tape.data, physique.data, bfMid, earliestBf, nutritionPhase, colors]);

  // Destination states from the REAL branch engine.
  const branchPaths = branchPathsV2(
    branchV2,
    {
      strength: stats.strengthScore,
      size: stats.sizeScore,
      leanness: stats.leannessScore,
      conditioning: stats.conditioningScore,
      aesthetic: stats.aestheticScore,
    },
    { nutritionPhase, earliestBf }
  );

  const branchState = (b: BranchV2): DestinationState => {
    if (b === branchV2) return { kind: 'active', met: 0, total: 0, missing: null };
    const path = branchPaths.find((p) => p.branch === b);
    if (!path) return { kind: 'locked', met: 0, total: 0, missing: null };
    const met = path.requirements.filter((r) => r.met).length;
    const total = path.requirements.length;
    const readiness = evolutionReadiness(path.requirements);
    const firstUnmet = path.requirements.find((r) => !r.met) ?? null;
    return {
      kind: met === total ? 'eligible' : readiness.percent > 0 ? 'progress' : 'locked',
      met,
      total,
      missing: firstUnmet ? `${firstUnmet.label} ${trim1(firstUnmet.current)} / ${trim1(firstUnmet.target)}` : null,
    };
  };

  return { paths, branchState };
}

export interface DestinationState {
  kind: 'active' | 'eligible' | 'progress' | 'locked';
  met: number;
  total: number;
  missing: string | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const trim1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// ---------------------------------------------------------------- pieces

/**
 * The RPG skill node: an outer SEGMENTED decorative ring (always faint), a
 * thick solid progress arc riding inside it, the number in the middle, and
 * a soft glow that only burns when there is real progress.
 */
function SkillRing({ pct, tint, size = 66 }: { pct: number | null; tint: string; size?: number }) {
  const colors = useThemeColors();
  const stroke = 5;
  const rOuter = (size - 3) / 2;
  const r = (size - 3) / 2 - 6;
  const c = 2 * Math.PI * r;
  const filled = pct === null ? 0 : clamp01(pct);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: size / 2,
        backgroundColor: 'rgba(4,10,20,0.6)',
        shadowColor: tint,
        shadowOpacity: filled > 0 ? 0.25 + filled * 0.35 : 0,
        shadowRadius: 12,
        elevation: filled > 0 ? 4 : 0,
      }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {/* segmented outer ring — the node casing */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={rOuter}
          stroke={pct === null ? 'rgba(120,170,220,0.18)' : `${tint}59`}
          strokeWidth={2}
          fill="none"
          strokeDasharray="4 5"
        />
        {/* progress track + arc */}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(120,170,220,0.14)" strokeWidth={stroke} fill="none" />
        {pct !== null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={tint}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * filled} ${c}`}
          />
        ) : null}
      </Svg>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 13, color: pct === null ? colors['text-mute'] : tint, ...pixelFont() }}
      >
        {pct === null ? '—' : `${Math.round(filled * 100)}%`}
      </Text>
    </View>
  );
}

/**
 * The panel's centrepiece: every node feeds this bar. Fills bottom-to-top
 * with the path percentage, glows harder as it fills, carries a faint
 * energy mote drifting upward (reduced-motion gated), and ends in the
 * arrow that hands the charge to the evolution below.
 */
function PowerBar({ percent, tint }: { percent: number; tint: string }) {
  const reducedMotion = useReducedMotion();
  const flow = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion || percent <= 0) return;
    flow.value = withRepeat(withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.quad) }), -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, percent]);
  const fillPct = Math.max(0, Math.min(100, percent));
  const mote = useAnimatedStyle(() => ({
    transform: [{ translateY: -flow.value * 96 }],
    opacity: flow.value < 0.12 ? flow.value * 6 : (1 - flow.value) * 0.9,
  }));
  return (
    <View style={{ width: 44, alignItems: 'center', alignSelf: 'stretch' }}>
      <View
        style={{
          flex: 1,
          width: 26,
          borderRadius: 13,
          borderWidth: 1.5,
          borderColor: `${tint}66`,
          backgroundColor: 'rgba(4,10,20,0.7)',
          overflow: 'hidden',
          justifyContent: 'flex-end',
          shadowColor: tint,
          shadowOpacity: 0.2 + (fillPct / 100) * 0.55,
          shadowRadius: 14,
          elevation: 5,
        }}
      >
        <View
          style={{
            height: `${fillPct}%`,
            minHeight: fillPct > 0 ? 6 : 0,
            backgroundColor: `${tint}cc`,
            borderRadius: 11,
            shadowColor: tint,
            shadowOpacity: 0.9,
            shadowRadius: 10,
          }}
        />
        {fillPct > 0 && !reducedMotion ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                bottom: 4,
                alignSelf: 'center',
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: '#ffffff',
                shadowColor: tint,
                shadowOpacity: 1,
                shadowRadius: 6,
              },
              mote,
            ]}
          />
        ) : null}
      </View>
      <Text
        style={{
          marginTop: 2,
          fontSize: 14,
          color: tint,
          textShadowColor: `${tint}99`,
          textShadowRadius: 8,
        }}
      >
        ▼
      </Text>
    </View>
  );
}

/** A glowing circuit trace from a node into the bar, junction dot at the end. */
function Connector({ tint, live, side }: { tint: string; live: boolean; side: 'left' | 'right' }) {
  const line = (
    <View
      style={{
        flex: 1,
        height: 2,
        borderRadius: 1,
        backgroundColor: live ? `${tint}8c` : 'rgba(120,170,220,0.18)',
        shadowColor: tint,
        shadowOpacity: live ? 0.7 : 0,
        shadowRadius: 6,
      }}
    />
  );
  const dot = (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: live ? tint : 'rgba(120,170,220,0.3)',
        shadowColor: tint,
        shadowOpacity: live ? 0.9 : 0,
        shadowRadius: 6,
        marginHorizontal: 1,
      }}
    />
  );
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      {side === 'left' ? line : dot}
      {side === 'left' ? dot : line}
    </View>
  );
}

function SkillNodeCell({ n, tint, onPress }: { n: SkillNodeData; tint: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ width: 104, alignItems: 'center', minHeight: 44 }}
      testID={`skill-${n.key}`}
    >
      <SkillRing pct={n.pct} tint={tint} />
      <Text
        className="mt-s1 text-center text-text"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ letterSpacing: 0.6, fontSize: 10, ...pixelFont(false) }}
      >
        {(n.short ?? n.name).toUpperCase()}
      </Text>
      {n.current !== null ? (
        <Text
          className="text-center text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 9, ...pixelFont(false) }}
        >
          {trim1(n.current)} / {trim1(n.target)} {n.unit}
        </Text>
      ) : (
        <Text className="text-center text-2xs text-text-mute" style={{ fontSize: 9 }}>
          Not tracked yet
        </Text>
      )}
    </Pressable>
  );
}

/** Compact destination: sprite on a small holo ring + real engine state. */
function PathDestination({
  branch,
  state,
  tint,
  sex,
  level,
  onViewEvolution,
}: {
  branch: BranchV2;
  state: DestinationState;
  tint: string;
  sex: 'male' | 'female';
  level: number;
  onViewEvolution: () => void;
}) {
  const colors = useThemeColors();
  const donor = branch === 'titan' ? 'mass' : branch === 'cardio' ? 'hybrid' : branch === 'shredder' ? 'aesthetic' : branch;
  const stage = donor === 'mass' || branch === 'cardio' ? massArtStage(level) : getBranchStage(donor, level);
  const art = avatarArtV2(branch, stage, sex);
  const active = state.kind === 'active';
  const badge =
    state.kind === 'active' ? 'ACTIVE' : state.kind === 'eligible' ? 'ELIGIBLE' : state.kind === 'progress' ? 'IN PROGRESS' : 'LOCKED';
  const badgeTint =
    state.kind === 'active' ? colors.success : state.kind === 'eligible' ? colors.accent : state.kind === 'progress' ? tint : colors['text-mute'];

  return (
    <View
      className="mt-s3 flex-row items-center gap-s3 rounded-xl p-s3"
      style={{
        borderWidth: 1,
        borderColor: active ? `${colors.success}59` : `${tint}33`,
        backgroundColor: 'rgba(6,12,24,0.55)',
        shadowColor: active ? colors.success : tint,
        shadowOpacity: active ? 0.35 : 0.15,
        shadowRadius: 14,
      }}
    >
      <View style={{ alignItems: 'center', width: 62 }}>
        {animatedAvatar(branch, stage, sex) ? (
          // Any line with a delivered rotation set previews its ROTATING
          // sprite (Tyson, 2026-07-16: mass line, then aesthetic stages
          // 1–4) — full strength when active/eligible, dimmed while the
          // gates are still closing. Sex-aware: no body substitution.
          <Image
            source={animatedAvatar(branch, stage, sex)}
            style={{
              width: 56,
              height: 62,
              opacity: active || state.kind === 'eligible' ? 1 : 0.55,
              ...({ imageRendering: 'pixelated' } as object),
            }}
            contentFit="contain"
          />
        ) : art.hasArt && (active || state.kind === 'eligible') ? (
          <Image source={art.source} style={{ width: 56, height: 62 }} contentFit="contain" />
        ) : (
          <Silhouette branch={donor as 'aesthetic' | 'mass' | 'hybrid'} stage={Math.min(stage, 4)} rim={tint} />
        )}
        <View
          style={{
            marginTop: -6,
            width: 54,
            height: 12,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: `${tint}8c`,
            backgroundColor: `${tint}14`,
            shadowColor: tint,
            shadowOpacity: 0.6,
            shadowRadius: 10,
          }}
        />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
            {branchDisplayNameV2(branch)}
          </Text>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, color: badgeTint, letterSpacing: 1, ...pixelFont(false) }}
          >
            {state.kind === 'locked' ? '🔒 ' : ''}
            {badge}
          </Text>
        </View>
        {state.kind !== 'active' ? (
          <Text className="text-2xs text-text-mute">
            {state.met} / {state.total} gates met
            {state.missing ? ` · missing ${state.missing}` : ''}
          </Text>
        ) : (
          <Text className="text-2xs text-text-mute">Your current branch.</Text>
        )}
        <Pressable onPress={onViewEvolution} accessibilityRole="button" className="mt-s1 self-start">
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            VIEW IN EVOLUTION ▸
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One skill path: HUD panel — header, 2×2 node grid, path bar, destination. */
function SkillPathPanel({
  path,
  branchState,
  sex,
  level,
  onViewEvolution,
  onNode,
}: {
  path: SkillPathData;
  branchState: (b: BranchV2) => DestinationState;
  sex: 'male' | 'female';
  level: number;
  onViewEvolution: () => void;
  onNode: (n: SkillNodeData, p: SkillPathData) => void;
}) {
  const tint = path.tint;
  const primary = path.destinations[0];
  const secondary = path.destinations[1] ?? null;
  return (
    <View
      className="rounded-xl p-s4"
      style={{
        borderWidth: 1,
        borderColor: `${tint}40`,
        backgroundColor: 'rgba(8,14,26,0.6)',
        shadowColor: tint,
        shadowOpacity: 0.16,
        shadowRadius: 18,
      }}
    >
      {/* corner ticks: HUD, not a card */}
      {([{ top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 }, { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 }] as const).map((c, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', width: 14, height: 14, borderColor: `${tint}cc`, ...c }} />
      ))}

      <View className="mb-s3 flex-row items-center gap-s3">
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: `${tint}66`,
            backgroundColor: `${tint}12`,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '45deg' }],
          }}
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: 11, color: tint, letterSpacing: 0.5, transform: [{ rotate: '-45deg' }], ...pixelFont() }}
          >
            {path.abbr}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 18, letterSpacing: 0.5, ...pixelFont() }}>
            {path.name}
          </Text>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            {path.eyebrow}
          </Text>
        </View>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 24, color: tint, textShadowColor: `${tint}99`, textShadowRadius: 14, ...pixelFont() }}
        >
          {path.percent}%
        </Text>
      </View>

      {/* THE SKILL NETWORK: four nodes wired into one central power bar
          that charges the evolution below. Connectors light up only when
          their node carries real progress. */}
      <View className="flex-row" style={{ alignItems: 'stretch' }}>
        {/* left nodes */}
        <View style={{ justifyContent: 'space-between' }}>
          <SkillNodeCell n={path.nodes[0]} tint={tint} onPress={() => onNode(path.nodes[0], path)} />
          <View style={{ height: 14 }} />
          <SkillNodeCell n={path.nodes[2]} tint={tint} onPress={() => onNode(path.nodes[2], path)} />
        </View>
        {/* left traces */}
        <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: 26 }}>
          <Connector tint={tint} live={(path.nodes[0].pct ?? 0) > 0} side="left" />
          <Connector tint={tint} live={(path.nodes[2].pct ?? 0) > 0} side="left" />
        </View>
        <PowerBar percent={path.percent} tint={tint} />
        {/* right traces */}
        <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: 26 }}>
          <Connector tint={tint} live={(path.nodes[1].pct ?? 0) > 0} side="right" />
          <Connector tint={tint} live={(path.nodes[3].pct ?? 0) > 0} side="right" />
        </View>
        {/* right nodes */}
        <View style={{ justifyContent: 'space-between' }}>
          <SkillNodeCell n={path.nodes[1]} tint={tint} onPress={() => onNode(path.nodes[1], path)} />
          <View style={{ height: 14 }} />
          <SkillNodeCell n={path.nodes[3]} tint={tint} onPress={() => onNode(path.nodes[3], path)} />
        </View>
      </View>

      <PathDestination
        branch={primary}
        state={branchState(primary)}
        tint={tint}
        sex={sex}
        level={level}
        onViewEvolution={onViewEvolution}
      />
      {secondary ? (
        <Text className="mt-s2 text-2xs text-text-mute">
          Also feeds <Text style={{ color: tint }}>{branchDisplayNameV2(secondary)}</Text> —{' '}
          {branchState(secondary).kind === 'active'
            ? 'your current branch.'
            : `${branchState(secondary).met}/${branchState(secondary).total} gates met.`}
        </Text>
      ) : null}
    </View>
  );
}

/** The node detail sheet — SummarySheet's Modal pattern. */
function SkillDetailSheet({
  detail,
  onClose,
}: {
  detail: { node: SkillNodeData; path: SkillPathData } | null;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  if (!detail) return null;
  const { node: n, path } = detail;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/70" onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <View
            className="rounded-t-2xl p-s5"
            style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderColor: `${path.tint}59` }}
          >
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              {path.name} · SKILL
            </Text>
            <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 24, ...pixelFont() }}>
              {n.name}
            </Text>

            {n.current !== null ? (
              <View className="mb-s3 flex-row gap-s3">
                <SheetStat label="CURRENT" value={`${trim1(n.current)}`} tint={path.tint} />
                <SheetStat label="TARGET" value={`${trim1(n.target)} ${n.unit}`} tint={path.tint} />
                <SheetStat label="PROGRESS" value={n.pct === null ? '—' : `${Math.round(n.pct * 100)}%`} tint={path.tint} />
              </View>
            ) : (
              <Text
                className="mb-s3 text-warn"
                allowFontScaling={false}
                style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont() }}
              >
                NOT TRACKED YET
              </Text>
            )}

            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              HOW IT&apos;S MEASURED
            </Text>
            <Text className="mb-s3 mt-s1 text-xs text-text-dim">{n.untrackedHint && n.current === null ? n.untrackedHint : n.how}</Text>

            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              NEXT ACTION
            </Text>
            <Text className="mt-s1 text-xs text-text-dim">{n.nextAction}</Text>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="mt-s4 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-2"
              testID="skill-sheet-close"
            >
              <Text
                className="text-text-dim"
                allowFontScaling={false}
                style={{ fontSize: 12, letterSpacing: 1, ...pixelFont() }}
              >
                CLOSE
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetStat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View
      className="flex-1 items-center rounded-md py-s2"
      style={{ borderWidth: 1, borderColor: `${tint}33`, backgroundColor: 'rgba(6,12,24,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 14, color: tint, ...pixelFont() }}>
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- view

export function SkillTreeView({ onViewEvolution }: { onViewEvolution: () => void }) {
  const { paths, branchState } = useSkillTree();
  const { sex, summary } = useAvatarData();
  const [detail, setDetail] = useState<{ node: SkillNodeData; path: SkillPathData } | null>(null);

  return (
    <>
      <View className="items-center">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          ATTRIBUTE PATHS
        </Text>
        <Text
          className="text-text"
          allowFontScaling={false}
          style={{ fontSize: 20, textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 16, ...pixelFont() }}
        >
          BUILD. LEVEL UP. UNLOCK.
        </Text>
        <Text className="text-2xs text-text-mute">Train attributes. Fill the paths. Unlock stronger forms.</Text>
      </View>

      {paths.map((p) => (
        <SkillPathPanel
          key={p.key}
          path={p}
          branchState={branchState}
          sex={sex}
          level={summary.level}
          onViewEvolution={onViewEvolution}
          onNode={(n, pathData) => setDetail({ node: n, path: pathData })}
        />
      ))}

      <SkillDetailSheet detail={detail} onClose={() => setDetail(null)} />
    </>
  );
}
