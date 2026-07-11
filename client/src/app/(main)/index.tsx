import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Link } from 'expo-router';

import { useClaimCoin, useCoinTotal } from '@/data/coins';
import { useServerGrantedXp, useWorkoutLog } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { getBranchStage, raritySlug } from '@/domain/avatar-stats';
import { branchDisplayNameV2, evolutionNameV2, nextEvolutionV2, shredderName, shredderStage } from '@/domain/branches-v2';
import { computeStreak } from '@/domain/streak';
import tokens from '@/theme/tokens';
import { avatarArtV2 } from '@/ui/avatar-art';
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
/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus, mirroring migration 014's leaderboard rule. */
function DriftWarning({ drift, source }: { drift: number; source: string }) {
  const serverGranted = useServerGrantedXp();
  if (drift === 0) return null;
  if (serverGranted.data !== null && serverGranted.data !== undefined && drift === serverGranted.data) return null;
  return (
    <Text className="text-2xs text-warn">
      ledger drift {drift} · source: {source}
    </Text>
  );
}

export default function HomeScreen() {
  const { summary, stats, bfMid, branchV2, sex, ready } = useAvatarData();
  const workouts = useWorkoutLog();
  const [showRadar, setShowRadar] = useState(false);

  // IMPROVEMENT_PLAN #12: the retroactive starting bonus — every onboarded
  // athlete claims it once; the unique index makes reloads a no-op.
  const coins = useCoinTotal();
  const claimCoins = useClaimCoin();
  const bonusTriedRef = useRef(false);
  useEffect(() => {
    if (!ready || bonusTriedRef.current) return;
    bonusTriedRef.current = true;
    claimCoins.mutate({ kind: 'starting_bonus', sourceId: 'onboarding' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const streak = useMemo(
    () => computeStreak(workouts.data ?? [], todayIso),
    [workouts.data, todayIso]
  );

  const evolution = nextEvolutionV2(branchV2, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });

  const stage = branchV2 === 'shredder' ? shredderStage(bfMid) : getBranchStage(stats.branch, summary.level);
  const art = avatarArtV2(branchV2, stage, sex);
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
            {branchV2 === 'shredder' ? shredderName(bfMid) : evolutionNameV2(branchV2, summary.level)}
          </Text>
          <Text className="text-xs text-text-dim">
            {branchDisplayNameV2(branchV2)} · {summary.rank}
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
      <HeroStage
        branch={stats.branch}
        stage={stage}
        auraColour={auraColour}
        source={art.source}
        silhouette={!art.hasArt}
      />
      {!art.hasArt ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : null}
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
        <Link href={'/streak' as never} asChild>
          <Pressable accessibilityRole="button" testID="streak-chip">
            <HUDChip
              label="DAY STREAK"
              value={`${streak.current}🔥`}
              tint={streak.current > 0 ? tokens.colors.legendary : tokens.colors.common}
            />
          </Pressable>
        </Link>
        <Link href={'/coins' as never} asChild>
          <Pressable accessibilityRole="button" testID="coin-chip">
            <HUDChip
              label="COINS"
              value={coins.data === null || coins.data === undefined ? '—' : coins.data}
              tint={tokens.colors.legendary}
            />
          </Pressable>
        </Link>
      </View>
      <DriftWarning drift={summary.xpDrift} source={summary.xpSource} />

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
