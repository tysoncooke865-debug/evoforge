import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, Text, View } from 'react-native';

import { evolutionReadiness } from '@/domain/evolution-readiness';
import type { NextEvolution } from '@/domain/next-evolution';
import tokens from '@/theme/tokens';

import { NeonButton } from './neon-button';
import { XpBar } from './xp-bar';

export interface WorkoutSummaryData {
  day: string;
  setsDone: number;
  setsTarget: number;
  xpBanked: number;
  prCount: number;
  streak: number;
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
  evolution: NextEvolution;
}

/**
 * The workout-complete ceremony: a dismissible sheet, never a browser alert.
 * Everything on it is confirmed state -- XP that landed, PRs the verdicts
 * detected, the streak derived from real dates, readiness from real
 * requirements. Honest numbers, premium frame.
 */
export function SummarySheet({
  data,
  onClose,
}: {
  data: WorkoutSummaryData | null;
  onClose: () => void;
}) {
  if (!data) return null;
  const complete = data.setsDone >= data.setsTarget;
  const readiness = evolutionReadiness(data.evolution.requirements);
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
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
              {complete ? 'WORKOUT COMPLETE' : 'WORKOUT FINISHED'}
            </Text>
            <Text
              className="mb-s4 text-2xl font-bold text-text"
              style={{ textShadowColor: `${accent}80`, textShadowRadius: 14 }}
            >
              {data.day}
            </Text>

            <View className="mb-s4 flex-row justify-between">
              <Cell value={`${data.setsDone}/${data.setsTarget}`} label="SETS" />
              <Cell value={`+${data.xpBanked}`} label="XP BANKED" tint={tokens.colors.accent} />
              <Cell value={String(data.prCount)} label={data.prCount === 1 ? 'NEW PR' : 'NEW PRS'} tint={tokens.colors.legendary} />
              <Cell value={`${data.streak}🔥`} label="STREAK" tint={tokens.colors.legendary} />
            </View>

            <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              LEVEL {data.level} PROGRESS
            </Text>
            <XpBar xpIntoLevel={data.xpIntoLevel} xpNeeded={data.xpNeeded} showNumbers={false} />
            <Text className="mb-s4 mt-s1 text-2xs text-text-dim">
              {data.xpIntoLevel} / {data.xpNeeded} XP
            </Text>

            <View className="mb-s5 flex-row items-center justify-between rounded-md p-s3" style={{ backgroundColor: 'rgba(168,85,247,0.08)', borderWidth: 1, borderColor: `${tokens.colors.epic}40` }}>
              <View>
                <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                  NEXT EVOLUTION
                </Text>
                <Text className="text-sm font-bold text-text">{data.evolution.targetName}</Text>
              </View>
              <Text className="text-xl font-bold" style={{ color: tokens.colors.epic }}>
                {readiness.percent}%
              </Text>
            </View>

            <NeonButton title="CONTINUE" onPress={onClose} testID="summary-close" />
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
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
