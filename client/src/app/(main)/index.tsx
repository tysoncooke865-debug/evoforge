import { ScrollView, Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import tokens from '@/theme/tokens';
import { AvatarCard } from '@/ui/avatar-card';
import { ScreenHeader } from '@/ui/screen-header';
import { StatMeter } from '@/ui/stat-meter';
import { XpBar } from '@/ui/xp-bar';

/**
 * Home: the character sheet. Everything derives from useAvatarData -- the
 * same assembly the Avatar page uses, so the two screens cannot disagree
 * about who the athlete is.
 */
export default function HomeScreen() {
  const { summary, stats } = useAvatarData();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <ScreenHeader kicker="EVOFORGE" title={summary.rank} />

        <AvatarCard branch={stats.branch} level={summary.level} />

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s2 text-xs text-text-mute">LEVEL {summary.level} PROGRESS</Text>
          <XpBar xpIntoLevel={summary.xpIntoLevel} xpNeeded={summary.xpNeeded} />
          <View className="mt-s4 flex-row justify-between">
            <Stat label="TOTAL SETS" value={String(summary.totalSets)} />
            <Stat label="TOTAL XP" value={String(summary.xp)} />
            <Stat label="CARDIO MIN" value={String(Math.trunc(summary.cardioMinutes))} />
          </View>
          {summary.xpDrift !== 0 ? (
            <Text className="mt-s2 text-2xs text-warn">
              ledger drift {summary.xpDrift} · source: {summary.xpSource}
            </Text>
          ) : null}
        </View>

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s1 text-xs text-text-mute">CHARACTER SHEET</Text>
          <Text className="mb-s3 text-sm font-bold text-text">
            {stats.characterClass}{' '}
            <Text className="font-normal text-text-mute">
              · {stats.buildType} · Focus: {stats.weakPointFocus}
            </Text>
          </Text>
          <StatMeter label="STRENGTH" value={stats.strengthScore} colour={tokens.colors.accent} />
          <StatMeter label="SIZE" value={stats.sizeScore} colour={tokens.colors.epic} />
          <StatMeter label="LEANNESS" value={stats.leannessScore} colour={tokens.colors.success} />
          <StatMeter label="CONDITIONING" value={stats.conditioningScore} colour={tokens.colors.rare} />
          <StatMeter label="AESTHETIC" value={stats.aestheticScore} colour={tokens.colors.mythic} />
        </View>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-lg font-bold text-accent">{value}</Text>
      <Text className="text-2xs text-text-mute">{label}</Text>
    </View>
  );
}
