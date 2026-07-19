import { Text, View } from 'react-native';

import type { LeaderboardMetric, RankedEntry } from '@/domain/leaderboard';
import { pixelFont } from '@/theme/fonts';

/** One leaderboard row — extracted VERBATIM from rank.tsx (P2 C5) so the
 *  Home teaser and the Rank screen render identically.
 *
 *  MULTI-METRIC (2026-07-19): the trailing column follows the active metric —
 *  Evo Rating / Forge Level / Consistency weeks / (default) Level + XP. The
 *  rank TITLE stays; only the emphasised number changes. Omitting `metric`
 *  keeps the original Level + XP tail (the legacy XP board / older callers). */
export function LeaderboardRowView({
  entry,
  self,
  metric,
}: {
  entry: RankedEntry;
  self: boolean;
  metric?: LeaderboardMetric;
}) {
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
      <MetricTail entry={entry} metric={metric} />
    </View>
  );
}

function MetricTail({ entry, metric }: { entry: RankedEntry; metric?: LeaderboardMetric }) {
  if (metric === 'evo') {
    return (
      <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
        {entry.evoRating == null ? '—' : entry.evoRating}
      </Text>
    );
  }
  if (metric === 'forge') {
    return (
      <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
        FORGE {entry.forgeLevel ?? entry.level}
      </Text>
    );
  }
  if (metric === 'consistency') {
    return (
      <Text className="text-success" allowFontScaling={false} style={{ fontSize: 13, ...pixelFont() }}>
        {entry.momentumWeeks ?? 0}w
      </Text>
    );
  }
  // Default / XP board: Level + XP, exactly as before.
  return (
    <>
      <Text className="mr-s3 text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
        Lv {entry.level}
      </Text>
      <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
        {entry.xp} XP
      </Text>
    </>
  );
}
