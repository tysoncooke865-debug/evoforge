import { Text, View } from 'react-native';

import type { RankedEntry } from '@/domain/leaderboard';
import { pixelFont } from '@/theme/fonts';

/** One leaderboard row — extracted VERBATIM from rank.tsx (P2 C5) so the
 *  Home teaser and the Rank screen render identically. */
export function LeaderboardRowView({ entry, self }: { entry: RankedEntry; self: boolean }) {
  return (
    <View
      className={`mb-s2 flex-row items-center rounded-md border p-s3 ${
        self ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
      }`}
    >
      <Text className="w-s10 text-accent" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
        {({ 1: '🥇', 2: '🥈', 3: '🥉' } as Record<number, string>)[entry.position] ?? `#${entry.position}`}
      </Text>
      <Text
        className="flex-1 text-text"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 15, ...pixelFont() }}
      >
        {entry.displayName}
      </Text>
      <Text className="mr-s3 text-xs text-text-mute">{entry.rank}</Text>
      <Text className="mr-s3 text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
        Lv {entry.level}
      </Text>
      <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
        {entry.xp} XP
      </Text>
    </View>
  );
}
