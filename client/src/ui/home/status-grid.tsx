import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { CoinIcon } from '@/ui/core/coin-icon';

import type { HomeFeatures } from './home-features';

/**
 * HOME_REDESIGN §6 — the player status row: FORGE STREAK · COINS · TOTAL XP
 * · ARENA RANK, each a door into its own system (/streak, /coins, /profile,
 * /rival). A two-by-two grid (the brief's standard-phone rule); hiding coins
 * reflows the grid naturally. Every value is the real one — coins render
 * `—` on null (unreadable ≠ empty wallet, the useLedgerXp lesson), and an
 * unplaced athlete reads UNRANKED with their real placement count.
 * `rank: null` (Rival Rank flag off) falls back to the level-tier card.
 */
export function StatusGrid({
  streakCurrent,
  streakBest,
  streakLabel,
  coins,
  totalXp,
  tierName,
  tierColour,
  rank,
  features,
}: {
  streakCurrent: number;
  streakBest: number;
  streakLabel: string;
  coins: number | null | undefined;
  totalXp: number;
  tierName: string;
  tierColour: string;
  /** The Rival Rank standing — label like "OBSIDIAN I", or provisional. */
  rank: { label: string; provisional: boolean; placements: string } | null;
  features: HomeFeatures;
}) {
  // The brief's responsive rule: four across on wide screens, 2×2 on
  // standard phones. flexBasis drives the wrap; nothing shrinks unreadable.
  const { width } = useWindowDimensions();
  const basis = width >= 500 ? ('21%' as const) : ('45%' as const);
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      <StatusCard
        icon={<Text style={{ fontSize: 14 }}>🔥</Text>}
        label={streakLabel}
        value={`${streakCurrent} DAY${streakCurrent === 1 ? '' : 'S'}`}
        sub={streakBest > 0 ? `Best: ${streakBest} days` : 'Start today'}
        tint={streakCurrent > 0 ? tokens.colors.legendary : tokens.colors['text-mute']}
        onPress={() => router.push('/streak' as never)}
        testID="status-streak"
        basis={basis}
      />
      {features.showCoins ? (
        <StatusCard
          icon={<CoinIcon size={16} />}
          label="COINS"
          value={coins === null || coins === undefined ? '—' : String(coins)}
          sub="View rewards ›"
          tint={tokens.colors.legendary}
          onPress={() => router.push('/coins' as never)}
          testID="status-coins"
          basis={basis}
        />
      ) : null}
      <StatusCard
        icon={<Text style={{ fontSize: 13, color: tokens.colors.accent }}>◇</Text>}
        label="TOTAL XP"
        value={totalXp.toLocaleString('en-US')}
        sub="All-time"
        tint={tokens.colors.accent}
        onPress={() => router.push('/profile' as never)}
        testID="status-xp"
        basis={basis}
      />
      {rank ? (
        <StatusCard
          icon={
            <Text
              style={{ fontSize: 13, color: rank.provisional ? tokens.colors['text-mute'] : tokens.colors.accent }}
            >
              ⚔
            </Text>
          }
          label="ARENA RANK"
          value={rank.provisional ? 'UNRANKED' : rank.label}
          sub={rank.provisional ? `${rank.placements} placements ›` : 'Rival standing ›'}
          tint={rank.provisional ? tokens.colors['text-mute'] : tokens.colors.accent}
          onPress={() => router.push('/rival' as never)}
          testID="status-rank"
          basis={basis}
        />
      ) : (
        <StatusCard
          icon={<Text style={{ fontSize: 13, color: tierColour }}>◆</Text>}
          label="TIER"
          value={tierName}
          sub="Rank standing ›"
          tint={tierColour}
          onPress={() => router.push('/rank' as never)}
          testID="status-tier"
          basis={basis}
        />
      )}
    </View>
  );
}

function StatusCard({
  icon,
  label,
  value,
  sub,
  tint,
  onPress,
  testID,
  basis = '45%',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tint: string;
  onPress: () => void;
  testID: string;
  basis?: '21%' | '45%';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${sub}`}
      testID={testID}
      className="rounded-md border p-s3"
      style={{
        flexGrow: 1,
        flexBasis: basis,
        minHeight: 76,
        borderColor: tokens.colors.border,
        backgroundColor: tokens.colors['surface-2'],
      }}
    >
      <View className="flex-row items-center" style={{ gap: 6 }}>
        {icon}
        <Text
          className="text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}
        >
          {label}
        </Text>
      </View>
      <Text
        className="mt-s1"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 16, letterSpacing: 0, color: tint, ...pixelFont() }}
      >
        {value}
      </Text>
      <Text className="text-2xs text-text-mute" numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}
