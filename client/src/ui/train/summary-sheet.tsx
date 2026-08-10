import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { COIN_SET_FLOOR, type SessionCoins } from '@/domain/coin-claims';
import { evolutionReadiness, requirementProgress } from '@/domain/evolution-readiness';
import type { MissionGrade } from '@/domain/progression/mission-grade';
import type { NextEvolution } from '@/domain/next-evolution';
import type { NextSession } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { NeonButton } from '@/ui/core/neon-button';
import { RevealClaimCard } from '@/ui/forge-reveal/reveal-chip';
import { SpriteCompanion } from '@/ui/character/sprite-avatar';
import { XpBar } from '@/ui/character/xp-bar';

export interface WorkoutSummaryData {
  day: string;
  setsDone: number;
  setsTarget: number;
  xpBanked: number;
  prCount: number;
  /** TRANSFORM P4: which lifts PR'd (deduped), for the reveal phase. */
  prExercises: string[];
  streak: number;
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
  evolution: NextEvolution;
  /** TRANSFORM P4: the next scheduled session, for the confirm phase. */
  nextSession: NextSession | null;
  /** 2026-08-03: the mission's grade and what earned it. */
  grade: MissionGrade;
  /** First set to last set, from the log's own timestamps. Null when the
   *  session was typed in afterwards and its timestamps say nothing. */
  minutes: number | null;
  /** Coins this session banks, from real coin_events. Null = not known yet. */
  coins: SessionCoins | null;
}


/**
 * THE COMPLETION SCREEN — one screen, everything on it (Tyson, 2026-08-06:
 * "replace the current sequence of separate completion modals with one
 * cohesive completion screen").
 *
 * It was an ordered sequence of five modal phases — summary → PR reveal →
 * level path → evolution progress → next session — behind up to five CONTINUE
 * taps, and writing the finish marker then raised a SIXTH modal asking whether
 * to share. Six dismissals to finish a workout, on the screen whose entire job
 * is to make finishing feel worth it.
 *
 * Now: the workout name and grade, completed sets, XP, coins, any PRs, the
 * Forge level, evolution progress and the next recommended session all render
 * together in one scroll. NOTHING was removed — every reward and every piece
 * of progression feedback that had a phase still has a section.
 *
 * ONE primary action, FINISH WORKOUT. Save as Routine, Share as Ghost and
 * Share with Friends are secondary and optional; sharing never blocks and
 * never opens by itself.
 *
 * Every number is confirmed state — XP that landed, PRs the verdicts detected,
 * readiness from real requirements, the next session from the persisted
 * schedule.
 */
export function SummarySheet({
  data,
  onClose,
  onSaveRoutine,
  onShareGhost,
  onShareFriends,
  defaultRoutineName = '',
  onFinish,
}: {
  data: WorkoutSummaryData | null;
  onClose: () => void;
  /** STAGE 1: save what was performed as a reusable routine. Absent when
   *  nothing was logged — there would be nothing to save. */
  onSaveRoutine?: (name: string) => void;
  /** GHOST (migration 037): publish this finished session for friends to fight. */
  onShareGhost?: () => void;
  /** Open the social composer for this workout. A CHOICE on this screen —
   *  it used to be a modal that opened by itself the moment the marker
   *  landed, which is the "separate blocking modal" the brief bans. */
  onShareFriends?: () => void;
  defaultRoutineName?: string;
  /**
   * TRAIN_IMPROVEMENTS: end the workout FOR REAL — write the finish marker.
   * When present, the ceremony's last button becomes FINISH WORKOUT and a
   * KEEP TRAINING escape sits beside it. Without it the sheet is what it was:
   * a summary you dismiss.
   */
  onFinish?: () => void;
}) {
  if (!data) return null;
  // Local state lives in Ceremony, which unmounts with the sheet — a fresh
  // finish always starts clean.
  return (
    <Ceremony
      data={data}
      onClose={onClose}
      onSaveRoutine={onSaveRoutine}
      onShareGhost={onShareGhost}
      onShareFriends={onShareFriends}
      defaultRoutineName={defaultRoutineName}
      onFinish={onFinish}
    />
  );
}

function Ceremony({
  data,
  onClose,
  onSaveRoutine,
  onShareGhost,
  onShareFriends,
  defaultRoutineName,
  onFinish,
}: {
  data: WorkoutSummaryData;
  onClose: () => void;
  onSaveRoutine?: (name: string) => void;
  /** GHOST (migration 037): publish this finished session for friends to fight. */
  onShareGhost?: () => void;
  onShareFriends?: () => void;
  defaultRoutineName: string;
  onFinish?: () => void;
}) {
  const colors = useThemeColors();

  // SAVE AS ROUTINE is about the workout you just did, not the level or the
  // evolution — it sits with the secondary actions at the foot of the screen.
  const [naming, setNaming] = useState(false);
  const [routineName, setRoutineName] = useState(defaultRoutineName);
  const [saved, setSaved] = useState(false);
  const [ghosted, setGhosted] = useState(false);

  const complete = data.setsDone >= data.setsTarget;
  const accent = complete ? colors.success : colors.accent;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-s5" style={{ backgroundColor: 'rgba(4,7,14,0.88)' }}>
        <View
          className="w-full max-w-[420px] overflow-hidden rounded-xl"
          style={{
            borderWidth: 1,
            borderColor: `${accent}66`,
            shadowColor: accent,
            shadowOpacity: 0.4,
            shadowRadius: 30,
            elevation: 12,
          }}
        >
          <LinearGradient
            colors={[colors['surface-2'], colors['bg-deep']]}
            style={{ padding: 24 }}
          >
            <View className="mb-s1 flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 8 }}>
                {/* THE VICTORY FLEX (Tyson, 2026-07-16): finishing a mission
                    is the app's victory moment — the companion hits a front
                    double bicep (9 frames, stages 2-4; stage 1 sways until
                    its flex art lands). */}
                <SpriteCompanion anim="victory" height={34} />
                <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
                  {complete ? 'MISSION COMPLETE' : 'MISSION FINISHED'}
                </Text>
              </View>
            </View>

            {/* EVERYTHING AT ONCE, in one scroll. This was five modal phases
                behind up to five CONTINUE taps (summary → PR → path →
                evolution → next), and finishing then raised a SIXTH, separate,
                blocking share modal. Nothing has been removed — the grade, the
                PRs, the Forge level, the evolution progress and the next
                session are all still here, just visible together instead of
                one at a time (Tyson, 2026-08-06). */}
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
              testID="completion-scroll"
            >
              <SummaryPhase data={data} accent={accent} />
              {data.prCount > 0 ? <PrPhase data={data} /> : null}
              <PathPhase data={data} />
              <EvolutionPhase data={data} />
              {data.nextSession ? <NextPhase data={data} /> : null}
            </ScrollView>

            {/* THE PRIMARY ACTION, alone and unmissable. */}
            <View className="mt-s3">
              <NeonButton
                title={onFinish ? 'FINISH WORKOUT' : 'DONE'}
                onPress={() => {
                  // Finishing writes a marker, so the decision survives the
                  // sheet closing. Without it, `complete` was re-derived on the
                  // next render and the workout sprang back to life.
                  onFinish?.();
                  onClose();
                }}
                testID="summary-done"
              />
            </View>

            {/* SECONDARY, and optional. Sharing is an offer, never a gate. */}
            <View className="mt-s3" style={{ gap: 8 }}>
              {onSaveRoutine && !saved ? (
                naming ? (
                  <View>
                    <TextInput
                      className="min-h-[44px] rounded-xl border bg-surface-2 px-s3 text-sm text-text"
                      style={{ borderColor: colors.border }}
                      value={routineName}
                      onChangeText={setRoutineName}
                      maxLength={60}
                      placeholder="Name this routine"
                      placeholderTextColor="#64758f"
                      testID="routine-name"
                    />
                    <View className="mt-s2">
                      <NeonButton
                        title="SAVE"
                        variant="ghost"
                        onPress={() => {
                          const n = routineName.trim();
                          if (n.length < 2) return;
                          onSaveRoutine(n);
                          // Optimistic: the mutation toasts its own failure, and
                          // a second tap would only collide on the unique index.
                          setSaved(true);
                          setNaming(false);
                        }}
                        testID="routine-save-confirm"
                      />
                    </View>
                  </View>
                ) : (
                  <NeonButton
                    title="SAVE AS ROUTINE"
                    variant="ghost"
                    onPress={() => setNaming(true)}
                    testID="save-as-routine"
                  />
                )
              ) : null}

              {saved ? (
                <Text className="text-center text-2xs font-bold" style={{ color: colors.success, letterSpacing: 1.5 }}>
                  ✓ SAVED TO MY ROUTINES
                </Text>
              ) : null}

              {onShareGhost ? (
                ghosted ? (
                  <Text className="text-center text-2xs font-bold" style={{ color: colors.epic, letterSpacing: 1.5 }}>
                    GHOST PUBLISHED — FRIENDS CAN BATTLE IT
                  </Text>
                ) : (
                  <NeonButton
                    title="👻 SHARE AS GHOST"
                    variant="ghost"
                    onPress={() => {
                      onShareGhost();
                      setGhosted(true); // optimistic; the mutation toasts its own failure
                    }}
                    testID="share-as-ghost"
                  />
                )
              ) : null}

              {/* SHARE WITH FRIENDS, as a CHOICE on this screen. It used to be
                  a modal that opened by itself the moment the marker landed —
                  a prompt the athlete had to dismiss to get back to the app. */}
              {onShareFriends ? (
                <NeonButton
                  title="SHARE WITH FRIENDS"
                  variant="ghost"
                  onPress={onShareFriends}
                  testID="share-with-friends"
                />
              ) : null}

              {onFinish ? (
                <NeonButton
                  title="KEEP TRAINING"
                  variant="ghost"
                  onPress={onClose}
                  testID="summary-keep-training"
                />
              ) : (
                <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="summary-close" />
              )}
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

/**
 * THE GRADE, REVEALED (2026-08-03, TRAIN brief). "Show: Mission Grade / A+ /
 * Workout Time / XP / Evo gained / PRs / Consistency / Streak. Confetti is NOT
 * appropriate. Use premium sci-fi effects instead."
 *
 * So: no confetti. The letter materialises inside a ring that opens around it,
 * a scan crosses the plate once, and the factor bars fill left to right. Three
 * windows on ONE 900ms one-shot value — the reveal costs one driver, and
 * reduced motion pins the whole thing arrived and readable.
 *
 * It sits at the TOP OF THE EXISTING PHASE rather than becoming a phase of its
 * own on purpose: the ceremony is already five taps deep at its longest, and
 * "increase workout completion" is not served by making finishing longer.
 */
function GradePlate({ grade, tint }: { grade: MissionGrade; tint: string }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    // "Mission Grade" is on the brief's haptics list, and it is the one moment
    // in the ceremony that is a VERDICT rather than a number — a medium tick
    // timed to the letter landing, not to the sheet opening. It fires even
    // under reduced motion: that setting is about movement, not about touch.
    const tick = setTimeout(() => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, reduced ? 0 : 300);
    if (!reduced) t.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    return () => clearTimeout(tick);
  }, [reduced, t]);

  const letter = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (t.value - 0.1) / 0.45));
    return { opacity: p, transform: [{ scale: 1.5 - p * 0.5 }] };
  });
  const ring = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, t.value / 0.55));
    return { opacity: p * 0.8, transform: [{ scale: 0.7 + p * 0.3 }] };
  });
  const sweep = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (t.value - 0.3) / 0.5));
    return { opacity: Math.sin(p * Math.PI) * 0.55, transform: [{ translateY: -50 + p * 130 }] };
  });

  return (
    <View className="mb-s3 items-center">
      <View style={{ width: 108, height: 88, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 84,
              height: 84,
              borderRadius: 42,
              borderWidth: 2,
              borderColor: `${tint}59`,
              shadowColor: tint,
              shadowOpacity: 0.8,
              shadowRadius: 22,
            },
            ring,
          ]}
        />
        <Animated.Text
          allowFontScaling={false}
          testID="mission-grade"
          style={[
            {
              fontSize: 52,
              lineHeight: 60,
              letterSpacing: 0,
              color: tint,
              textShadowColor: `${tint}b3`,
              textShadowRadius: 24,
              ...pixelFont(),
            },
            letter,
          ]}
        >
          {grade.grade}
        </Animated.Text>
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: tint },
            sweep,
          ]}
        />
      </View>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 2.4, color: colors['text-mute'], ...pixelFont(false) }}
      >
        MISSION GRADE · {grade.score}
      </Text>
    </View>
  );
}

/** One judged factor. "NOT MEASURED" is said out loud — the athlete is told
 *  which parts of their grade were judged and which were filled neutral. */
function FactorRow({ label, detail, earned, measured, tint }: {
  label: string;
  detail: string;
  earned: number;
  measured: boolean;
  tint: string;
}) {
  const colors = useThemeColors();
  const colour = measured ? tint : colors['text-mute'];
  return (
    <View className="mb-s2">
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.4, color: colors['text-dim'], ...pixelFont(false) }}
        >
          {label}
        </Text>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 9, letterSpacing: 0.6, color: measured ? colors['text-dim'] : colors['text-mute'], ...pixelFont(false) }}
        >
          {detail}
        </Text>
      </View>
      <View className="mt-s1 h-[4px] overflow-hidden rounded-pill bg-surface-3">
        <View
          style={{
            width: `${Math.round(earned * 100)}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: colour,
            opacity: measured ? 1 : 0.45,
          }}
        />
      </View>
    </View>
  );
}

function SummaryPhase({ data, accent }: { data: WorkoutSummaryData; accent: string }) {
  const colors = useThemeColors();
  // The grade's colour is the verdict's, not the session's: S and A+ are gold,
  // A is the app's own cyan, B and C are quiet. Colour is never the only cue —
  // the letter and the score are right there.
  const gradeTint =
    data.grade.grade === 'S' || data.grade.grade === 'A+'
      ? colors.legendary
      : data.grade.grade === 'A'
        ? accent
        : colors['text-dim'];

  const cells: { value: string; label: string; tint?: string }[] = [
    { value: `${data.setsDone}/${data.setsTarget}`, label: 'SETS' },
    ...(data.minutes !== null ? [{ value: `${data.minutes}`, label: 'MINUTES' }] : []),
    { value: `+${data.xpBanked}`, label: 'XP BANKED', tint: colors.accent },
    // COINS, derived from real coin_events against the 013 guard's own rules
    // (domain/coin-claims.ts). Absent while the history loads, and absent
    // rather than guessed — a promised +25 that never banks is worse than no
    // number at all.
    ...(data.coins !== null && data.coins.amount > 0
      ? [{ value: `+${data.coins.amount}`, label: 'COINS', tint: colors.legendary }]
      : []),
    { value: String(data.prCount), label: data.prCount === 1 ? 'NEW PR' : 'NEW PRS', tint: colors.legendary },
    { value: `${data.streak}🔥`, label: 'STREAK', tint: colors.legendary },
  ];

  return (
    <View>
      <GradePlate grade={data.grade} tint={gradeTint} />
      <Text
        className="mb-s3 text-center text-xl font-bold text-text"
        numberOfLines={1}
        style={{ textShadowColor: `${accent}80`, textShadowRadius: 14 }}
      >
        {data.day}
      </Text>
      {data.grade.factors.map((f) => (
        <FactorRow
          key={f.key}
          label={f.label}
          detail={f.detail}
          earned={f.earned}
          measured={f.measured}
          tint={gradeTint}
        />
      ))}
      {data.grade.bonuses.length > 0 ? (
        <View className="mb-s2 flex-row flex-wrap" style={{ gap: 6 }}>
          {data.grade.bonuses.map((b) => (
            <View
              key={b.label}
              className="rounded-pill border px-s2"
              style={{ minHeight: 22, justifyContent: 'center', borderColor: `${colors.legendary}45`, backgroundColor: `${colors.legendary}12` }}
            >
              <Text className="text-2xs font-bold" style={{ color: colors.legendary, letterSpacing: 0.6 }}>
                +{b.points} {b.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {/* CENTRED WITH A REAL COLUMN GAP, not space-between: the grade pass
          added MINUTES, and five cells edge-to-edge welded their labels into
          "XP BANKEDNEW PRSSTREAK". Wrapping is allowed and looks deliberate. */}
      <View
        className="mb-s5 mt-s2 flex-row flex-wrap justify-center"
        style={{ columnGap: 16, rowGap: 12 }}
      >
        {cells.map((c) => (
          <Cell key={c.label} value={c.value} label={c.label} tint={c.tint} />
        ))}
      </View>
      {/* THE FORGE, AFTER THE WORKOUT AND NOT DURING IT (v5 §3). This is the
          primary claim surface: a PR grants a reveal silently mid-session and it
          waits here, so nothing variable ever lands between sets. */}
      <RevealClaimCard />
      {/* Why there are no coins, in the guard's own words. Silence here read
          as "coins are broken". */}
      {data.coins?.blocked ? (
        <Text className="mb-s4 text-center text-2xs text-text-mute" testID="summary-coins-note">
          {data.coins.blocked === 'floor'
            ? `Coins bank at ${COIN_SET_FLOOR}+ counted sets in a day.`
            : 'Coins for today are already banked.'}
        </Text>
      ) : null}
    </View>
  );
}

function PrPhase({ data }: { data: WorkoutSummaryData }) {
  const colors = useThemeColors();
  return (
    <View className="mb-s5">
      <Text
        className="mb-s3 text-2xl font-bold"
        style={{ color: colors.legendary, textShadowColor: `${colors.legendary}80`, textShadowRadius: 14 }}
      >
        {data.prCount === 1 ? 'NEW PERSONAL RECORD' : `${data.prCount} NEW PERSONAL RECORDS`}
      </Text>
      {data.prExercises.map((name) => (
        <View
          key={name}
          className="mb-s2 rounded-md p-s3"
          style={{ backgroundColor: 'rgba(250,204,21,0.08)', borderWidth: 1, borderColor: `${colors.legendary}40` }}
        >
          <Text className="text-sm font-bold text-text">🏆 {name}</Text>
        </View>
      ))}
      <Text className="mt-s1 text-2xs text-text-dim">Heaviest estimated one-rep max to date.</Text>
    </View>
  );
}

function PathPhase({ data }: { data: WorkoutSummaryData }) {
  return (
    <View className="mb-s5">
      <Text className="mb-s3 text-2xl font-bold text-text">LEVEL {data.level}</Text>
      <XpBar xpIntoLevel={data.xpIntoLevel} xpNeeded={data.xpNeeded} showNumbers={false} />
      <Text className="mt-s1 text-2xs text-text-dim">
        {data.xpIntoLevel} / {data.xpNeeded} XP · +{data.xpBanked} banked this mission
      </Text>
    </View>
  );
}

function EvolutionPhase({ data }: { data: WorkoutSummaryData }) {
  const colors = useThemeColors();
  const readiness = evolutionReadiness(data.evolution.requirements);
  return (
    <View className="mb-s5">
      <View className="mb-s3 flex-row items-center justify-between">
        <View>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            NEXT EVOLUTION
          </Text>
          <Text className="text-lg font-bold text-text">{data.evolution.targetName}</Text>
        </View>
        <Text className="text-2xl font-bold" style={{ color: colors.epic }}>
          {readiness.percent}%
        </Text>
      </View>
      {data.evolution.requirements.map((req) => {
        const pct = Math.round(requirementProgress(req) * 100);
        return (
          <View key={req.label} className="mb-s2">
            <View className="flex-row justify-between">
              <Text className="text-2xs font-bold text-text-dim">{req.label.toUpperCase()}</Text>
              <Text className="text-2xs font-bold" style={{ color: req.met ? colors.success : colors['text-mute'] }}>
                {req.met ? '✓ MET' : `${fmtReq(req.current)} / ${fmtReq(req.target)}`}
              </Text>
            </View>
            <View className="mt-s1 h-[6px] overflow-hidden rounded-pill bg-surface-3">
              <View
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: req.met ? colors.success : colors.epic,
                  minWidth: pct > 0 ? 4 : 0,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function NextPhase({ data }: { data: WorkoutSummaryData }) {
  const colors = useThemeColors();
  const next = data.nextSession;
  if (!next) return null;
  const when =
    next.inDays === 1 ? 'TOMORROW' : `${WEEKDAYS[new Date(`${next.date}T00:00:00Z`).getUTCDay()]} · IN ${next.inDays} DAYS`;
  return (
    <View className="mb-s5">
      <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
        NEXT MISSION
      </Text>
      <Text className="text-2xl font-bold text-text">{next.day}</Text>
      <Text className="mt-s1 text-sm font-bold" style={{ color: colors.accent, letterSpacing: 1.5 }}>
        {when}
      </Text>
    </View>
  );
}

function fmtReq(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Cell({ value, label, tint }: { value: string; label: string; tint?: string }) {
  const colors = useThemeColors();
  const tintColor = tint ?? colors.text;
  return (
    <View className="items-center" style={{ minWidth: 54 }}>
      <Text className="text-lg font-bold" numberOfLines={1} style={{ color: tintColor }}>
        {value}
      </Text>
      <Text className="text-2xs text-text-mute" numberOfLines={1} style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
    </View>
  );
}
