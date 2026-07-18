import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useFriends } from '@/data/social';
import { useSocialFeed, useToggleReaction, type FeedScope } from '@/data/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelPeople } from '@/ui/core/pixel-icons';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { socialFeatures } from '@/ui/social/social-features';
import { SocialPostCard } from '@/ui/social/post-cards';

/**
 * SOCIAL — real fitness activity as a feed of PRs, workouts, level-ups, Evo
 * gains, evolutions and rivalries. Built on the friends/rivalry foundation
 * (migration 036) + the feed backend (049). Until 049 is applied and
 * `socialFeatures.feedEnabled` is flipped, the tab is an honest COMING SOON —
 * never a mocked feed. When live: Following / Rivals / Discover, a friends
 * activity row, and the typed post cards.
 */
const TABS: readonly { key: FeedScope; label: string }[] = [
  { key: 'following', label: 'FOLLOWING' },
  { key: 'rivals', label: 'RIVALS' },
  { key: 'discover', label: 'DISCOVER' },
];

export default function SocialScreen() {
  if (!socialFeatures.feedEnabled) return <ComingSoon />;
  return <SocialFeed />;
}

function SocialFeed() {
  const colors = useThemeColors();
  const [scope, setScope] = useState<FeedScope>('following');
  const [nowMs] = useState(() => Date.now());
  const feed = useSocialFeed(scope);
  const react = useToggleReaction();
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="THE GUILD"
        title="SOCIAL"
        right={
          <Pressable
            onPress={() => router.push('/friends' as never)}
            accessibilityRole="button"
            accessibilityLabel="friends and requests"
            testID="social-friends"
            className="items-center justify-center rounded-lg border p-s2"
            style={{ minHeight: 44, minWidth: 44, borderColor: `${colors.accent}59` }}
          >
            <PixelPeople size={18} color={colors.accent} />
          </Pressable>
        }
      />

      {/* Feed tabs. */}
      <View className="w-full flex-row rounded-pill border p-s1" style={{ borderColor: `${colors.epic}33`, backgroundColor: 'rgba(13,21,36,0.6)', gap: 4 }}>
        {TABS.map((t) => {
          const on = scope === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setScope(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`social-tab-${t.key}`}
              className="flex-1 items-center justify-center rounded-pill"
              style={{ minHeight: 40, backgroundColor: on ? 'rgba(34,211,238,0.14)' : 'transparent', borderWidth: on ? 1 : 0, borderColor: `${colors.accent}8c` }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, color: on ? colors.accent : colors['text-dim'], ...pixelFont(false) }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FriendsRow />

      {/* The feed. */}
      {feed.isPending ? (
        <FeedSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState scope={scope} />
      ) : (
        <View style={{ gap: 14 }}>
          {posts.map((p) => (
            <SocialPostCard key={p.id} post={p} nowMs={nowMs} onReact={(kind) => react.mutate({ postId: p.id, kind })} />
          ))}
          {feed.hasNextPage ? (
            <Pressable
              onPress={() => void feed.fetchNextPage()}
              accessibilityRole="button"
              testID="social-more"
              className="items-center justify-center rounded-lg border py-s3"
              style={{ borderColor: colors.border, minHeight: 44 }}
            >
              <Text className="text-2xs text-text-dim" style={{ letterSpacing: 1 }}>
                {feed.isFetchingNextPage ? 'LOADING…' : 'LOAD MORE'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScreenShell>
  );
}

/** The horizontal friends activity row + a Find Friends tile. */
function FriendsRow() {
  const colors = useThemeColors();
  const friends = useFriends();
  const list = friends.data ?? [];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
      {list.map((f) => (
        <Pressable
          key={f.id}
          onPress={() => router.push('/friends' as never)}
          accessibilityRole="button"
          accessibilityLabel={`${f.display_name}, rival record ${f.my_wins}-${f.their_wins}`}
          testID={`social-friend-${f.id}`}
          className="items-center"
          style={{ width: 64 }}
        >
          <View className="items-center justify-center rounded-lg border" style={{ width: 52, height: 52, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.08)' }}>
            <Text allowFontScaling={false} style={{ fontSize: 20, color: colors.accent, ...pixelFont() }}>{(f.display_name[0] ?? 'A').toUpperCase()}</Text>
          </View>
          <Text className="mt-s1 text-2xs text-text-dim" numberOfLines={1} style={{ maxWidth: 62 }}>{f.display_name}</Text>
          <Text className="text-2xs text-text-mute">{f.my_wins}–{f.their_wins}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => router.push('/friends' as never)}
        accessibilityRole="button"
        accessibilityLabel="find friends"
        testID="social-find-friends"
        className="items-center"
        style={{ width: 64 }}
      >
        <View className="items-center justify-center rounded-lg border" style={{ width: 52, height: 52, borderStyle: 'dashed', borderColor: colors.border }}>
          <Text style={{ fontSize: 22, color: colors['text-mute'] }}>＋</Text>
        </View>
        <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>Find</Text>
      </Pressable>
    </ScrollView>
  );
}

function EmptyState({ scope }: { scope: FeedScope }) {
  const colors = useThemeColors();
  const copy = {
    following: { title: 'YOUR FORGE IS QUIET', body: 'Add friends to see PRs, workouts and evolutions.', cta: 'FIND FRIENDS' },
    rivals: { title: 'NO ACTIVE RIVALRIES', body: 'Challenge a friend and turn training into competition.', cta: 'CHALLENGE A FRIEND' },
    discover: { title: 'THE NETWORK IS FORMING', body: 'Public athlete discovery is coming online.', cta: null as string | null },
  }[scope];
  return (
    <GlowCard glow={colors.epic}>
      <View className="items-center py-s5">
        <PixelPeople size={30} color={colors.epic} />
        <Text className="mt-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 1, ...pixelFont() }}>{copy.title}</Text>
        <Text className="mt-s2 max-w-[280px] text-center text-sm text-text-dim">{copy.body}</Text>
        {copy.cta ? (
          <Pressable onPress={() => router.push('/friends' as never)} accessibilityRole="button" testID="social-empty-cta" className="mt-s3 rounded-lg border px-s4 py-s2" style={{ borderColor: `${colors.accent}8c`, minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, ...pixelFont(false) }}>{copy.cta}</Text>
          </Pressable>
        ) : null}
      </View>
    </GlowCard>
  );
}

function FeedSkeleton() {
  const colors = useThemeColors();
  return (
    <View style={{ gap: 14 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} className="rounded-xl border p-s4" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.4)' }}>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: colors['surface-2'] }} />
            <View style={{ gap: 6 }}>
              <View style={{ width: 120, height: 10, borderRadius: 4, backgroundColor: colors['surface-2'] }} />
              <View style={{ width: 80, height: 8, borderRadius: 4, backgroundColor: colors['surface-2'] }} />
            </View>
          </View>
          <View className="mt-s3" style={{ height: 54, borderRadius: 10, backgroundColor: colors['surface-2'] }} />
        </View>
      ))}
    </View>
  );
}

/** The honest placeholder while the feed backend is unbuilt / the flag is off. */
function ComingSoon() {
  const colors = useThemeColors();
  return (
    <ScreenShell>
      <ScreenHeader kicker="THE GUILD" title="SOCIAL" />
      <GlowCard glow={colors.epic}>
        <View className="items-center py-s6">
          <View className="items-center justify-center rounded-xl border" style={{ width: 72, height: 72, borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.08)' }}>
            <PixelPeople size={36} color={colors.epic} />
          </View>
          <Text className="mt-s4 text-text" allowFontScaling={false} style={{ fontSize: 20, letterSpacing: 1, textShadowColor: `${colors.epic}8c`, textShadowRadius: 14, ...pixelFont() }}>
            COMING SOON
          </Text>
          <Text className="mt-s2 max-w-[300px] text-center text-sm text-text-dim">
            Rivals, friends and the guild are being forged. Your training already counts toward it —
            check back soon.
          </Text>
        </View>
      </GlowCard>
    </ScreenShell>
  );
}
