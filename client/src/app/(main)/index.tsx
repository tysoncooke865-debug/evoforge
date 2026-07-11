import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWorkoutLog } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { branchDisplayName, evolutionName, getBranchStage, raritySlug } from '@/domain/avatar-stats';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { computeStreak } from '@/domain/streak';
import tokens from '@/theme/tokens';
import { EvolutionTeaser } from '@/ui/evolution-teaser';
import { HeroStage } from '@/ui/hero-stage';
import { DividerGlow, EdgeLabel, HUDChip } from '@/ui/hud';
import { RarityBadge } from '@/ui/rarity-badge';
import { ScreenShell } from '@/ui/shell';
import { StatBar } from '@/ui/stat-bar';
import { StatRadar } from '@/ui/stat-radar';
import { XpBar } from '@/ui/xp-bar';

/**
 * Home: the character screen. Layered HUD over a stage — not a stack of
 * cards. Identity → living character → progress → fast stats → build →
 * next-evolution teaser, in that hierarchy. All real state via
 * useAvatarData; the streak derives from workout dates client-side.
 */
export default function HomeScreen() {
  const { summary, stats, bfMid } = useAvatarData();
  const workouts = useWorkoutLog();
  const [showRadar, setShowRadar] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const streak = useMemo(
    () => computeStreak(workouts.data ?? [], todayIso),
    [workouts.data, todayIso]
  );

  const evolution = nextEvolutionInfo(stats.branch, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });

  const stage = getBranchStage(stats.branch, summary.level);
  const slug = raritySlug(summary.level);
  const auraColour = (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;

  return (
    <ScreenShell>
      {/* A. Identity — floating, no card. */}
      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
            EVOFORGE
          </Text>
          <Text
            className="text-3xl font-bold text-text"
            style={{ textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 18 }}
          >
            {evolutionName(stats.branch, summary.level)}
          </Text>
          <Text className="text-xs text-text-dim">
            {branchDisplayName(stats.branch)} · {summary.rank}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            LEVEL
          </Text>
          <Text
            className="text-3xl font-bold"
            style={{ color: tokens.colors.accent, textShadowColor: 'rgba(34,211,238,0.6)', textShadowRadius: 16 }}
          >
            {summary.level}
          </Text>
        </View>
      </View>

      {/* B. The stage — the character owns the viewport. */}
      <HeroStage branch={stats.branch} stage={stage} auraColour={auraColour} />
      <View className="-mt-s4 items-center gap-s2">
        <RarityBadge level={summary.level} />
      </View>

      {/* C. Progress — edge-labelled, no card. */}
      <View>
        <EdgeLabel right={<Text className="text-2xs text-text-mute">{summary.xpNeeded - summary.xpIntoLevel} XP to level {Math.min(summary.level + 1, 100)}</Text>}>
          LEVEL PROGRESS
        </EdgeLabel>
        <View className="mt-s2">
          <XpBar xpIntoLevel={summary.xpIntoLevel} xpNeeded={summary.xpNeeded} />
        </View>
      </View>

      {/* D. Fast stats — floating HUD chips. */}
      <View className="flex-row flex-wrap gap-s2">
        <HUDChip label="SETS" value={summary.totalSets} />
        <HUDChip label="XP" value={summary.xp} />
        <HUDChip label="CARDIO MIN" value={Math.trunc(summary.cardioMinutes)} tint={tokens.colors.rare} />
        <HUDChip
          label={streak.current === 1 ? 'DAY STREAK' : 'DAY STREAK'}
          value={`${streak.current}🔥`}
          tint={streak.current > 0 ? tokens.colors.legendary : tokens.colors.common}
        />
      </View>
      {summary.xpDrift !== 0 ? (
        <Text className="text-2xs text-warn">
          ledger drift {summary.xpDrift} · source: {summary.xpSource}
        </Text>
      ) : null}

      <DividerGlow />

      {/* E. Character build — RPG stat rows; radar on demand. */}
      <View>
        <EdgeLabel
          right={
            <Pressable onPress={() => setShowRadar((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle radar view">
              <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
                {showRadar ? 'BARS' : 'RADAR'}
              </Text>
            </Pressable>
          }
        >
          {`${stats.characterClass.toUpperCase()} · ${stats.buildType.toUpperCase()}`}
        </EdgeLabel>
        <View className="mt-s3">
          {showRadar ? (
            <StatRadar
              stats={[
                { label: 'STR', value: stats.strengthScore },
                { label: 'SIZE', value: stats.sizeScore },
                { label: 'LEAN', value: stats.leannessScore },
                { label: 'COND', value: stats.conditioningScore },
                { label: 'AES', value: stats.aestheticScore },
              ]}
            />
          ) : (
            <>
              <StatBar abbr="STR" name="Strength" value={stats.strengthScore} colour={tokens.colors.accent} />
              <StatBar abbr="SIZE" name="Mass" value={stats.sizeScore} colour={tokens.colors.epic} />
              <StatBar abbr="LEAN" name="Leanness" value={stats.leannessScore} colour={tokens.colors.success} />
              <StatBar abbr="COND" name="Engine" value={stats.conditioningScore} colour={tokens.colors.rare} />
              <StatBar abbr="AES" name="Aesthetic" value={stats.aestheticScore} colour={tokens.colors.mythic} />
            </>
          )}
        </View>
        <Text className="text-2xs text-text-mute">
          Weak point focus: <Text className="text-text-dim">{stats.weakPointFocus}</Text>
        </Text>
      </View>

      {/* F. Next evolution — always in sight. */}
      <EvolutionTeaser branch={stats.branch} evolution={evolution} />
    </ScreenShell>
  );
}
