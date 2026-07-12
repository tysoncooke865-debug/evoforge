import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useLeaderboardTop, usePublicIdentity } from '@/data/hooks';
import { rankLeaderboard } from '@/domain/leaderboard';
import { durations } from '@/theme/animations';
import tokens from '@/theme/tokens';
import { EdgeLabel } from '@/ui/hud';
import { LeaderboardRowView } from '@/ui/leaderboard-row';

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
      style={{ borderWidth: 1, borderColor: `${tokens.colors.accent}40`, backgroundColor: 'rgba(13,21,36,0.5)' }}
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
  const board = useLeaderboardTop(10);

  const optedIn = Boolean(identity.data?.displayName && identity.data.isPublic);
  if (!optedIn) {
    return (
      <View className="px-s4 pb-s4">
        <Text className="mb-s2 text-2xs text-text-mute">
          Only a display name, level and XP — never body data.
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

  const ranked = rankLeaderboard(board.data ?? []);
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
