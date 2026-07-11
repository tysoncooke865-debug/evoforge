import { Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import tokens from '@/theme/tokens';
import { AvatarCard } from '@/ui/avatar-card';
import { ScreenHeader, SectionLabel } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';
import { StatRadar } from '@/ui/stat-radar';
import { XpBar } from '@/ui/xp-bar';

/**
 * Home: the character screen. Hero avatar, the level as the biggest number
 * on the page, the attribute radar. Everything derives from useAvatarData --
 * the same assembly the Avatar page uses, so the two screens cannot disagree.
 */
export default function HomeScreen() {
  const { summary, stats } = useAvatarData();

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="EVOFORGE"
        title={summary.rank.replace(/^\S+\s/, '')}
        right={<LevelBadge level={summary.level} />}
      />

      <AvatarCard branch={stats.branch} level={summary.level} />

      <GlowCard>
        <View className="mb-s2 flex-row items-baseline justify-between">
          <SectionLabel>LEVEL PROGRESS</SectionLabel>
          <Text className="text-xs text-text-mute">
            {summary.xpNeeded - summary.xpIntoLevel} XP to level {Math.min(summary.level + 1, 100)}
          </Text>
        </View>
        <XpBar xpIntoLevel={summary.xpIntoLevel} xpNeeded={summary.xpNeeded} />
        <View className="mt-s5 flex-row justify-between">
          <BigStat label="TOTAL SETS" value={summary.totalSets} />
          <BigStat label="TOTAL XP" value={summary.xp} />
          <BigStat label="CARDIO MIN" value={Math.trunc(summary.cardioMinutes)} />
        </View>
        {summary.xpDrift !== 0 ? (
          <Text className="mt-s3 text-2xs text-warn">
            ledger drift {summary.xpDrift} · source: {summary.xpSource}
          </Text>
        ) : null}
      </GlowCard>

      <GlowCard>
        <SectionLabel>ATTRIBUTES</SectionLabel>
        <Text className="mb-s2 text-lg font-bold text-text">
          {stats.characterClass}
          <Text className="text-sm font-normal text-text-mute">  ·  {stats.buildType}</Text>
        </Text>
        <StatRadar
          stats={[
            { label: 'STR', value: stats.strengthScore },
            { label: 'SIZE', value: stats.sizeScore },
            { label: 'LEAN', value: stats.leannessScore },
            { label: 'COND', value: stats.conditioningScore },
            { label: 'AES', value: stats.aestheticScore },
          ]}
        />
        <Text className="mt-s3 text-center text-xs text-text-mute">
          Weak point focus: <Text className="text-text-dim">{stats.weakPointFocus}</Text>
        </Text>
      </GlowCard>
    </ScreenShell>
  );
}

function LevelBadge({ level }: { level: number }) {
  return (
    <View className="items-center pl-s4">
      <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
        LEVEL
      </Text>
      <Text
        className="text-3xl font-bold"
        style={{
          color: tokens.colors.accent,
          textShadowColor: 'rgba(34, 211, 238, 0.6)',
          textShadowRadius: 16,
        }}
      >
        {level}
      </Text>
    </View>
  );
}

function BigStat({ label, value }: { label: string; value: number }) {
  return (
    <View className="items-center">
      <Text className="text-2xl font-bold text-text">{value}</Text>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        {label}
      </Text>
    </View>
  );
}
