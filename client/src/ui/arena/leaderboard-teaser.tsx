/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated in press/layout handlers by design, same as segmented-tabs. */
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useLeaderboardByMetric, usePublicIdentity } from '@/data/hooks';
import { rankByMetric } from '@/domain/leaderboard';
import { durations } from '@/theme/animations';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Icon, isArtIcon, type ArtIconName } from '@/ui/core/icons';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardRowView } from '@/ui/arena/leaderboard-row';

/**
 * The Home leaderboard teaser (P2 C5): a collapsible strip under the
 * evolution teaser, CYAN-framed to distinguish it from the purple
 * evolution strip. Collapsed by default; the data body only mounts after
 * the first expansion. Height animates by MEASURED content height inside
 * an overflow-hidden container — not Reanimated layout animations (web
 * safety, same rule as everywhere else). Drift gating stays the Rank
 * screen's job — this teaser stays dumb and just links there.
 */
export function LeaderboardTeaser() {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const [contentH, setContentH] = useState(0);
  const height = useSharedValue(0);
  const heightStyle = useAnimatedStyle(() => ({ height: height.value }));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setOpenedOnce(true);
    height.value = withTiming(next ? contentH : 0, { duration: durations.panel });
  };

  return (
    <View
      className="w-full rounded-xl"
      style={{ borderWidth: 1, borderColor: `${colors.accent}40`, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        className="min-h-[48px] flex-row items-center justify-between px-s4 py-s3"
        testID="leaderboard-teaser"
      >
        <EdgeLabel>LEADERBOARD</EdgeLabel>
        <View className="flex-row items-center gap-s2">
          <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
            TOP ATHLETES
          </Text>
          <Text
            className="text-xs text-accent"
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          >
            ▼
          </Text>
        </View>
      </Pressable>

      {/* THE PODIUM, ALWAYS VISIBLE (2026-08-07). The board used to be a
          closed drawer, so an athlete who never tapped it saw no competition
          at all — the world looked empty when it was not. Three names and
          three ratings, before any interaction.

          Shown to everyone, including athletes who have not joined: this is
          the same public board the Rank screen renders, and seeing who is up
          there is the reason to join. */}
      <TopThree />

      <Animated.View style={[{ overflow: 'hidden' }, heightStyle]}>
        <View
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setContentH(h);
            // Re-sync if content grows while open (data landing late).
            if (open && h !== contentH) {
              height.value = withTiming(h, { duration: durations.panel });
            }
          }}
        >
          {openedOnce ? <TeaserBody /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

function TeaserBody() {
  const identity = usePublicIdentity();
  // Home's teaser reflects the EVO RATING board (2026-07-19).
  const board = useLeaderboardByMetric('evo', 10);

  const optedIn = Boolean(identity.data?.displayName && identity.data.isPublic);
  if (!optedIn) {
    return (
      <View className="px-s4 pb-s4">
        <Text className="mb-s2 text-2xs text-text-mute">
          Only a display name and game stats — never body data.
        </Text>
        <Link href={'/rank' as never} asChild>
          <Pressable accessibilityRole="button" testID="teaser-join">
            <Text className="text-xs font-bold text-accent" style={{ letterSpacing: 1 }}>
              JOIN THE BOARD →
            </Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const ranked = rankByMetric(board.data ?? []);
  return (
    <View className="px-s4 pb-s4">
      {ranked.length === 0 ? (
        <Text className="mb-s2 text-2xs text-text-mute">The leaderboard is warming up…</Text>
      ) : (
        ranked.map((e) => (
          <LeaderboardRowView
            key={`${e.position}-${e.displayName}`}
            entry={e}
            self={e.displayName === identity.data?.displayName}
            metric="evo"
          />
        ))
      )}
      <Link href={'/rank' as never} asChild>
        <Pressable accessibilityRole="button" testID="teaser-full">
          <Text className="text-xs font-bold text-accent" style={{ letterSpacing: 1 }}>
            VIEW FULL LEADERBOARD →
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

/** ICON PASS (2026-08-11): the podium was three colour emoji, rendered by the
 *  platform's emoji font and belonging to no part of this app's palette. Same
 *  PixelLab art the full leaderboard row uses, so the teaser and the board
 *  cannot show two different podiums. */
const MEDALS = ['medal-gold', 'medal-silver', 'medal-bronze'] as const;

/**
 * The top three, and YOUR line when you are not one of them.
 *
 * Renders nothing while the board is loading and nothing if it is genuinely
 * empty — "the leaderboard is warming up" under a heading is worse than no
 * heading, and this app does not invent athletes to fill a podium.
 */
function TopThree() {
  const colors = useThemeColors();
  const identity = usePublicIdentity();
  const board = useLeaderboardByMetric('evo', 100);

  const ranked = rankByMetric(board.data ?? []).filter((e) => e.evoRating !== null && e.evoRating !== undefined);
  if (board.isPending || ranked.length === 0) return null;

  const me = identity.data?.displayName ?? null;
  const top = ranked.slice(0, 3);
  const myIndex = me === null ? -1 : ranked.findIndex((e) => e.displayName === me);
  // Only show a separate "you" line when you are NOT already on the podium.
  const mine = myIndex >= 3 ? ranked[myIndex] : null;

  return (
    <View className="px-s4 pb-s3" testID="leaderboard-podium">
      {top.map((e, i) => (
        <PodiumRow
          key={`${e.position}-${e.displayName}`}
          badge={MEDALS[i]}
          name={e.displayName}
          rating={e.evoRating ?? 0}
          self={e.displayName === me}
        />
      ))}
      {mine ? (
        <>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <PodiumRow badge={`#${myIndex + 1}`} name={mine.displayName} rating={mine.evoRating ?? 0} self />
        </>
      ) : null}
    </View>
  );
}

function PodiumRow({
  badge,
  name,
  rating,
  self,
}: {
  /** Podium art for the top three; a plain rank string ("#7") for the "you"
   *  line below the fold. Fourth place has no medal and never gets one. */
  badge: ArtIconName | string;
  name: string;
  rating: number;
  self: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center py-s1" style={{ gap: 8 }}>
      <View style={{ minWidth: 22 }}>
        {isArtIcon(badge as ArtIconName) ? (
          <Icon name={badge as ArtIconName} size={14} label={null} />
        ) : (
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors['text-mute'] }}>
            {badge}
          </Text>
        )}
      </View>
      <Text
        className={self ? 'text-text' : 'text-text-dim'}
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: self ? '700' : '400' }}
      >
        {self ? 'You' : name}
      </Text>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 13, letterSpacing: 0, color: self ? colors.accent : colors['text-mute'], ...pixelFont() }}
      >
        {rating}
      </Text>
    </View>
  );
}
