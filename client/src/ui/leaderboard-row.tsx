import { Text, View } from 'react-native';

import type { RankedEntry } from '@/domain/leaderboard';

/** One leaderboard row — extracted VERBATIM from rank.tsx (P2 C5) so the
 *  Home teaser and the Rank screen render identically. */
export function LeaderboardRowView({ entry, self }: { entry: RankedEntry; self: boolean }) {
  return (
    <View
      className={`mb-s2 flex-row items-center rounded-md border p-s3 ${
        self ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
      }`}
    >
      <Text className="w-s10 text-sm font-bold text-accent">
        {({ 1: '🥇', 2: '🥈', 3: '🥉' } as Record<number, string>)[entry.position] ?? `#${entry.position}`}
      </Text>
      <Text className="flex-1 font-bold text-text" numberOfLines={1}>
        {entry.displayName}
      </Text>
      <Text className="mr-s3 text-xs text-text-mute">{entry.rank}</Text>
      <Text className="mr-s3 text-sm font-bold text-text">Lv {entry.level}</Text>
      <Text className="text-xs text-text-dim">{entry.xp} XP</Text>
    </View>
  );
}
