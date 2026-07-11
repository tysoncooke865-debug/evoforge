import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useCardioLog, useLatestMeasurements, usePhysiqueRatings } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { branchDisplayNameV2, branchPathsV2, type BranchV2 } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { getBranchStage } from '@/domain/avatar-stats';
import { pyFloat } from '@/domain/py';
import tokens from '@/theme/tokens';
import { avatarArtV2 } from '@/ui/avatar-art';
import { Silhouette } from '@/ui/silhouette';

/**
 * The SKILL TREE subview: individual attributes as progress nodes, each
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
      tint: tokens.colors.accent,
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
      tint: tokens.colors.rare,
      destinations: ['cardio', 'hybrid'],
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
      tint: tokens.colors.epic,
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
      tint: tokens.colors.mythic,
      destinations: ['aesthetic', 'hybrid'],
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
      tint: tokens.colors.success,
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
  }, [stats, cardio.data, tape.data, physique.data, bfMid, earliestBf, nutritionPhase]);

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

/** SVG progress ring: track + tinted arc + the number in the middle. */
function SkillRing({ pct, tint, size = 58 }: { pct: number | null; tint: string; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct === null ? 0 : clamp01(pct);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(120,170,220,0.16)" strokeWidth={stroke} fill="none" />
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
      <Text className="text-xs font-bold" style={{ color: pct === null ? tokens.colors['text-mute'] : tint }}>
        {pct === null ? '—' : `${Math.round(filled * 100)}%`}
      </Text>
    </View>
  );
}

function SkillNodeCell({ n, tint, onPress }: { n: SkillNodeData; tint: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-[44px] flex-1 flex-row items-center gap-s2 py-s2"
      testID={`skill-${n.key}`}
    >
      <SkillRing pct={n.pct} tint={tint} />
      <View className="flex-1">
        <Text className="text-2xs font-bold text-text" numberOfLines={1} style={{ letterSpacing: 0.8 }}>
          {(n.short ?? n.name).toUpperCase()}
        </Text>
        {n.current !== null ? (
          <Text className="text-2xs text-text-mute" numberOfLines={1}>
            {trim1(n.current)} / {trim1(n.target)} {n.unit}
          </Text>
        ) : (
          <Text className="text-2xs text-text-mute" numberOfLines={2}>
            Not tracked yet
          </Text>
        )}
      </View>
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
  const donor = branch === 'titan' ? 'mass' : branch === 'cardio' ? 'hybrid' : branch === 'shredder' ? 'aesthetic' : branch;
  const stage = getBranchStage(donor, level);
  const art = avatarArtV2(branch, stage, sex);
  const active = state.kind === 'active';
  const badge =
    state.kind === 'active' ? 'ACTIVE' : state.kind === 'eligible' ? 'ELIGIBLE' : state.kind === 'progress' ? 'IN PROGRESS' : 'LOCKED';
  const badgeTint =
    state.kind === 'active' ? tokens.colors.success : state.kind === 'eligible' ? tokens.colors.accent : state.kind === 'progress' ? tint : tokens.colors['text-mute'];

  return (
    <View
      className="mt-s3 flex-row items-center gap-s3 rounded-xl p-s3"
      style={{
        borderWidth: 1,
        borderColor: active ? `${tokens.colors.success}59` : `${tint}33`,
        backgroundColor: 'rgba(6,12,24,0.55)',
        shadowColor: active ? tokens.colors.success : tint,
        shadowOpacity: active ? 0.35 : 0.15,
        shadowRadius: 14,
      }}
    >
      <View style={{ alignItems: 'center', width: 62 }}>
        {art.hasArt && (active || state.kind === 'eligible') ? (
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
          <Text className="text-sm font-bold text-text">{branchDisplayNameV2(branch)}</Text>
          <Text className="text-2xs font-bold" style={{ color: badgeTint, letterSpacing: 1.5 }}>
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
          <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
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
          <Text className="text-2xs font-bold" style={{ color: tint, letterSpacing: 1, transform: [{ rotate: '-45deg' }] }}>
            {path.abbr}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-lg font-bold text-text" style={{ letterSpacing: 1 }}>
            {path.name}
          </Text>
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
            {path.eyebrow}
          </Text>
        </View>
        <Text
          className="text-2xl font-bold"
          style={{ color: tint, textShadowColor: `${tint}99`, textShadowRadius: 14 }}
        >
          {path.percent}%
        </Text>
      </View>

      {/* 2×2 node grid with a circuit spine down the middle */}
      <View className="flex-row">
        <View className="flex-1 pr-s2">
          <SkillNodeCell n={path.nodes[0]} tint={tint} onPress={() => onNode(path.nodes[0], path)} />
          <SkillNodeCell n={path.nodes[2]} tint={tint} onPress={() => onNode(path.nodes[2], path)} />
        </View>
        <View style={{ width: 10, alignItems: 'center' }}>
          <View style={{ flex: 1, width: 2, borderRadius: 1, backgroundColor: `${tint}30` }} />
          <View
            style={{
              position: 'absolute',
              top: '30%',
              bottom: `${100 - Math.max(30, Math.min(96, 30 + path.percent * 0.66))}%`,
              width: 2,
              borderRadius: 1,
              backgroundColor: tint,
              shadowColor: tint,
              shadowOpacity: 0.8,
              shadowRadius: 6,
            }}
          />
        </View>
        <View className="flex-1 pl-s2">
          <SkillNodeCell n={path.nodes[1]} tint={tint} onPress={() => onNode(path.nodes[1], path)} />
          <SkillNodeCell n={path.nodes[3]} tint={tint} onPress={() => onNode(path.nodes[3], path)} />
        </View>
      </View>

      {/* the path bar into the destination */}
      <View className="mt-s2 h-s2 overflow-hidden rounded-pill bg-surface-3">
        <View
          style={{
            width: `${path.percent}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: tint,
            minWidth: path.percent > 0 ? 4 : 0,
            shadowColor: tint,
            shadowOpacity: 0.6,
            shadowRadius: 8,
          }}
        />
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
  if (!detail) return null;
  const { node: n, path } = detail;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/70" onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <View
            className="rounded-t-2xl p-s5"
            style={{ backgroundColor: tokens.colors.surface, borderTopWidth: 1, borderColor: `${path.tint}59` }}
          >
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
              {path.name} · SKILL
            </Text>
            <Text className="mb-s3 text-2xl font-bold text-text">{n.name}</Text>

            {n.current !== null ? (
              <View className="mb-s3 flex-row gap-s3">
                <SheetStat label="CURRENT" value={`${trim1(n.current)}`} tint={path.tint} />
                <SheetStat label="TARGET" value={`${trim1(n.target)} ${n.unit}`} tint={path.tint} />
                <SheetStat label="PROGRESS" value={n.pct === null ? '—' : `${Math.round(n.pct * 100)}%`} tint={path.tint} />
              </View>
            ) : (
              <Text className="mb-s3 text-sm font-bold text-warn">NOT TRACKED YET</Text>
            )}

            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              HOW IT&apos;S MEASURED
            </Text>
            <Text className="mb-s3 mt-s1 text-xs text-text-dim">{n.untrackedHint && n.current === null ? n.untrackedHint : n.how}</Text>

            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              NEXT ACTION
            </Text>
            <Text className="mt-s1 text-xs text-text-dim">{n.nextAction}</Text>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="mt-s4 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-2"
              testID="skill-sheet-close"
            >
              <Text className="text-xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
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
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        {label}
      </Text>
      <Text className="text-sm font-bold" style={{ color: tint }}>
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
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
          FITNESS SKILL TREE
        </Text>
        <Text
          className="text-xl font-bold text-text"
          style={{ letterSpacing: 1, textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 16 }}
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
