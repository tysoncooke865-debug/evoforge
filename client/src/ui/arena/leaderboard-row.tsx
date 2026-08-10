import { Text, View } from 'react-native';

import type { LeaderboardMetric, RankedEntry } from '@/domain/leaderboard';
import { pixelFont } from '@/theme/fonts';
import { Icon, type ArtIconName } from '@/ui/core/icons';

/** Podium art by position. Fourth place has no medal, and inventing one would
 *  be worse than a number. */
const MEDAL_FOR: Record<number, ArtIconName | undefined> = {
  1: 'medal-gold',
  2: 'medal-silver',
  3: 'medal-bronze',
};

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
  const medal = MEDAL_FOR[entry.position];
  return (
    <View
      className={`mb-s2 flex-row items-center rounded-md border p-s3 ${
        self ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
      }`}
    >
      {/* THE PODIUM (icon pass, 2026-08-11). Was three colour emoji, which
          rendered in the platform's own emoji font — round, glossy, and from a
          different app to everything around them. The medals are the one place
          colour genuinely IS the information (gold vs silver vs bronze cannot
          be a tint of one shape), so they are PixelLab art rather than glyphs.
          Positions 4+ keep the number: there is no medal for fourth. */}
      <View className="w-s10">
        {medal ? (
          <Icon name={medal} size={16} label={`position ${entry.position}`} />
        ) : (
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            {`#${entry.position}`}
          </Text>
        )}
      </View>
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
