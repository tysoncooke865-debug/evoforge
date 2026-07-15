import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';

import { evolutionReadiness, requirementProgress } from '@/domain/evolution-readiness';
import type { NextEvolution } from '@/domain/next-evolution';
import type { NextSession } from '@/domain/scheduled-streak';
import tokens from '@/theme/tokens';

import { NeonButton } from '@/ui/core/neon-button';
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
}

type PhaseKey = 'summary' | 'pr' | 'path' | 'evolution' | 'next';

/**
 * TRANSFORM P4 — the MISSION COMPLETE ceremony. The old single sheet is now
 * an ordered sequence: summary → PR reveal (only when one landed) → level
 * path → evolution progress → next-session confirmation (only when a
 * schedule exists). Every phase is confirmed state — XP that landed, PRs
 * the verdicts detected, readiness from real requirements, the next session
 * from the persisted schedule. SKIP dismisses instantly from any phase
 * (testID summary-close, unchanged, so pre-ceremony tours still pass).
 */
export function SummarySheet({
  data,
  onClose,
  onSaveRoutine,
  defaultRoutineName = '',
  onFinish,
}: {
  data: WorkoutSummaryData | null;
  onClose: () => void;
  /** STAGE 1: save what was performed as a reusable routine. Absent when
   *  nothing was logged — there would be nothing to save. */
  onSaveRoutine?: (name: string) => void;
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
  // Phase state lives in Ceremony, which unmounts with the sheet — a fresh
  // finish always starts at phase one.
  return (
    <Ceremony
      data={data}
      onClose={onClose}
      onSaveRoutine={onSaveRoutine}
      defaultRoutineName={defaultRoutineName}
      onFinish={onFinish}
    />
  );
}

function Ceremony({
  data,
  onClose,
  onSaveRoutine,
  defaultRoutineName,
  onFinish,
}: {
  data: WorkoutSummaryData;
  onClose: () => void;
  onSaveRoutine?: (name: string) => void;
  defaultRoutineName: string;
  onFinish?: () => void;
}) {
  const phases: PhaseKey[] = [
    'summary',
    ...(data.prCount > 0 ? (['pr'] as const) : []),
    'path',
    'evolution',
    ...(data.nextSession ? (['next'] as const) : []),
  ];
  const [idx, setIdx] = useState(0);
  const phase = phases[idx];
  const last = idx === phases.length - 1;

  // SAVE AS ROUTINE lives on the summary phase only — it is about the workout
  // you just did, not about the level or the evolution.
  const [naming, setNaming] = useState(false);
  const [routineName, setRoutineName] = useState(defaultRoutineName);
  const [saved, setSaved] = useState(false);

  const complete = data.setsDone >= data.setsTarget;
  const accent = complete ? tokens.colors.success : tokens.colors.accent;

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
            colors={[tokens.colors['surface-2'], tokens.colors['bg-deep']]}
            style={{ padding: 24 }}
          >
            <View className="mb-s1 flex-row items-center justify-between">
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
                {complete ? 'MISSION COMPLETE' : 'MISSION FINISHED'}
              </Text>
              <View className="flex-row" style={{ gap: 5 }}>
                {phases.map((p, i) => (
                  <View
                    key={p}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === idx ? accent : tokens.colors['surface-3'],
                    }}
                  />
                ))}
              </View>
            </View>

            {phase === 'summary' ? <SummaryPhase data={data} accent={accent} /> : null}

            {phase === 'summary' && onSaveRoutine && !saved ? (
              naming ? (
                <View className="mb-s4">
                  <TextInput
                    className="min-h-[44px] rounded-xl border bg-surface-2 px-s3 text-sm text-text"
                    style={{ borderColor: tokens.colors.border }}
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
                <View className="mb-s4">
                  <NeonButton
                    title="SAVE AS ROUTINE"
                    variant="ghost"
                    onPress={() => setNaming(true)}
                    testID="save-as-routine"
                  />
                </View>
              )
            ) : null}

            {phase === 'summary' && saved ? (
              <Text className="mb-s4 text-center text-2xs font-bold" style={{ color: tokens.colors.success, letterSpacing: 1.5 }}>
                ✓ SAVED TO MY ROUTINES
              </Text>
            ) : null}
            {phase === 'pr' ? <PrPhase data={data} /> : null}
            {phase === 'path' ? <PathPhase data={data} /> : null}
            {phase === 'evolution' ? <EvolutionPhase data={data} /> : null}
            {phase === 'next' ? <NextPhase data={data} /> : null}

            <NeonButton
              title={
                last
                  ? onFinish
                    ? 'FINISH WORKOUT'
                    : phase === 'next'
                      ? "I'LL BE THERE"
                      : 'CONTINUE'
                  : 'CONTINUE'
              }
              onPress={
                last
                  ? () => {
                      // THE FIX: finishing writes a marker, so the decision
                      // survives the sheet closing. Without it, `complete` was
                      // re-derived on the next render and the workout sprang
                      // back to life.
                      onFinish?.();
                      onClose();
                    }
                  : () => setIdx(idx + 1)
              }
              testID={last ? 'summary-done' : 'summary-next'}
            />
            {last && onFinish ? (
              <View className="mt-s2">
                <NeonButton
                  title="KEEP TRAINING"
                  variant="ghost"
                  onPress={onClose}
                  testID="summary-keep-training"
                />
              </View>
            ) : null}
            {!last ? (
              <View className="mt-s2">
                <NeonButton title="SKIP" variant="ghost" onPress={onClose} testID="summary-close" />
              </View>
            ) : null}
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

function SummaryPhase({ data, accent }: { data: WorkoutSummaryData; accent: string }) {
  return (
    <View>
      <Text
        className="mb-s4 text-2xl font-bold text-text"
        style={{ textShadowColor: `${accent}80`, textShadowRadius: 14 }}
      >
        {data.day}
      </Text>
      <View className="mb-s5 flex-row justify-between">
        <Cell value={`${data.setsDone}/${data.setsTarget}`} label="SETS" />
        <Cell value={`+${data.xpBanked}`} label="XP BANKED" tint={tokens.colors.accent} />
        <Cell value={String(data.prCount)} label={data.prCount === 1 ? 'NEW PR' : 'NEW PRS'} tint={tokens.colors.legendary} />
        <Cell value={`${data.streak}🔥`} label="STREAK" tint={tokens.colors.legendary} />
      </View>
    </View>
  );
}

function PrPhase({ data }: { data: WorkoutSummaryData }) {
  return (
    <View className="mb-s5">
      <Text
        className="mb-s3 text-2xl font-bold"
        style={{ color: tokens.colors.legendary, textShadowColor: `${tokens.colors.legendary}80`, textShadowRadius: 14 }}
      >
        {data.prCount === 1 ? 'NEW PERSONAL RECORD' : `${data.prCount} NEW PERSONAL RECORDS`}
      </Text>
      {data.prExercises.map((name) => (
        <View
          key={name}
          className="mb-s2 rounded-md p-s3"
          style={{ backgroundColor: 'rgba(250,204,21,0.08)', borderWidth: 1, borderColor: `${tokens.colors.legendary}40` }}
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
        <Text className="text-2xl font-bold" style={{ color: tokens.colors.epic }}>
          {readiness.percent}%
        </Text>
      </View>
      {data.evolution.requirements.map((req) => {
        const pct = Math.round(requirementProgress(req) * 100);
        return (
          <View key={req.label} className="mb-s2">
            <View className="flex-row justify-between">
              <Text className="text-2xs font-bold text-text-dim">{req.label.toUpperCase()}</Text>
              <Text className="text-2xs font-bold" style={{ color: req.met ? tokens.colors.success : tokens.colors['text-mute'] }}>
                {req.met ? '✓ MET' : `${fmtReq(req.current)} / ${fmtReq(req.target)}`}
              </Text>
            </View>
            <View className="mt-s1 h-[6px] overflow-hidden rounded-pill bg-surface-3">
              <View
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: req.met ? tokens.colors.success : tokens.colors.epic,
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
      <Text className="mt-s1 text-sm font-bold" style={{ color: tokens.colors.accent, letterSpacing: 1.5 }}>
        {when}
      </Text>
    </View>
  );
}

function fmtReq(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Cell({ value, label, tint = tokens.colors.text }: { value: string; label: string; tint?: string }) {
  return (
    <View className="items-center">
      <Text className="text-xl font-bold" style={{ color: tint }}>
        {value}
      </Text>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
        {label}
      </Text>
    </View>
  );
}
