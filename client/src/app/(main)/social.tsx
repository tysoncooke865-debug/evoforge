import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { usePublicIdentity } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { nameError } from '@/domain/leaderboard';
import { useFriends } from '@/data/social';
import { useDeletePost, useSocialFeed, useToggleReaction, type FeedScope } from '@/data/social-feed';
import { useDiscoverAthletes } from '@/data/social-profile';
import { useUnreadCount } from '@/data/social-notifications';
import { AddFriendButton } from '@/ui/social/add-friend-button';
import { GymsView } from '@/ui/social/gyms-view';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBell, PixelPeople } from '@/ui/core/pixel-icons';
import { ReportSheet } from '@/ui/social/report-sheet';
import { ScreenHeader } from '@/ui/core/screen-header';
import { FlatListShell, GlowCard, ScreenShell } from '@/ui/core/shell';
import { socialFeatures } from '@/ui/social/social-features';
import { CommentsModal } from '@/ui/social/comments';
import { CreatePostModal } from '@/ui/social/create-post';
import { NotificationsModal } from '@/ui/social/notifications';
import { SocialPostCard } from '@/ui/social/post-cards';

/**
 * SOCIAL — real fitness activity as a feed of PRs, workouts, level-ups, Evo
 * gains, evolutions and rivalries. Built on the friends/rivalry foundation
 * (migration 036) + the feed backend (049). Until 049 is applied and
 * `socialFeatures.feedEnabled` is flipped, the tab is an honest COMING SOON —
 * never a mocked feed. When live: Following / Rivals / Discover, a friends
 * activity row, and the typed post cards.
 */
// GYMS (068) is a non-feed scope, branched like RIVALS — FeedScope stays
// feed-only so the feed backend is untouched.
type SocialTab = FeedScope | 'gyms';
const TABS: readonly { key: SocialTab; label: string }[] = [
  { key: 'following', label: 'FEED' },
  { key: 'rivals', label: 'RIVALS' },
  { key: 'discover', label: 'DISCOVER' },
  { key: 'gyms', label: 'GYMS' },
];

export default function SocialScreen() {
  if (!socialFeatures.feedEnabled) return <ComingSoon />;
  return <SocialFeed />;
}

function SocialFeed() {
  const colors = useThemeColors();
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;
  const [scope, setScope] = useState<SocialTab>('following');
  const [nowMs] = useState(() => Date.now());
  const [composerOpen, setComposerOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = useUnreadCount().data ?? 0;
  // The feed backend only knows FeedScope; GYMS/RIVALS render their own views.
  const feed = useSocialFeed(scope === 'gyms' ? 'discover' : scope);
  const react = useToggleReaction();
  const del = useDeletePost();
  // §6.3: usernames are mandatory for NEW accounts (onboarding); accounts
  // from before claim theirs here — browsing stays open, posting waits.
  const identity = usePublicIdentity();
  const needsName = identity.data !== undefined && !identity.data?.displayName;
  const posts = feed.data?.pages.flat() ?? [];

  // B6: the feed is a virtualised list now — everything above the posts is
  // the list header; non-feed scopes render with an empty data array.
  const feedPosts = scope === 'rivals' || scope === 'gyms' ? [] : posts;
  const headerContent = (
    <>
      <ScreenHeader
        kicker="THE GUILD"
        title="SOCIAL"
        right={
          <View className="flex-row" style={{ gap: 8 }}>
            <Pressable
              onPress={() => setNotifOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`notifications${unread > 0 ? `, ${unread} unread` : ''}`}
              testID="social-notifications"
              className="items-center justify-center rounded-lg border p-s2"
              style={{ minHeight: 44, minWidth: 44, borderColor: `${colors.accent}59` }}
            >
              {/* §6.4: the pixel bell, in the PixelGlyph language the other
                  header icons already speak (the emoji broke the set). */}
              <PixelBell size={18} color={colors.accent} />
              {unread > 0 ? (
                <View className="absolute items-center justify-center rounded-pill" style={{ top: 2, right: 2, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: colors.danger }} testID="notif-badge">
                  <Text allowFontScaling={false} style={{ fontSize: 9, color: '#fff', fontWeight: '900' }}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => {
                if (needsName) return; // the claim card below explains
                setComposerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={needsName ? 'claim a username to post' : 'create a post'}
              testID="social-create"
              className="items-center justify-center rounded-lg border p-s2"
              style={{ minHeight: 44, minWidth: 44, borderColor: `${colors.epic}8c`, backgroundColor: 'rgba(168,85,247,0.1)' }}
            >
              <Text style={{ fontSize: 20, color: colors.epic, lineHeight: 22 }}>＋</Text>
            </Pressable>
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
          </View>
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

      {needsName ? <ClaimNameCard /> : null}

      <FriendsRow />

      {scope === 'discover' ? <DiscoverAthletes /> : null}

      {/* RIVALS + GYMS are their own views (records / groups), not a post feed. */}
      {scope === 'rivals' ? <RivalriesView /> : null}
      {scope === 'gyms' ? <GymsView /> : null}
      {scope !== 'rivals' && scope !== 'gyms' && feed.isPending ? <FeedSkeleton /> : null}
      {scope !== 'rivals' && scope !== 'gyms' && !feed.isPending && posts.length === 0 ? (
        <EmptyState scope={scope} />
      ) : null}
    </>
  );

  return (
    <>
      <FlatListShell
        data={feedPosts}
        keyExtractor={(p) => p.id}
        header={headerContent}
        onEndReached={() => {
          // B6: LOAD MORE became infinite scroll — the button was a manual
          // stand-in for pagination the list can drive itself.
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        footer={
          feed.isFetchingNextPage ? (
            <Text className="py-s3 text-center text-2xs text-text-dim" style={{ letterSpacing: 1 }} testID="social-more">
              LOADING…
            </Text>
          ) : null
        }
        renderItem={(p) => (
          <SocialPostCard
            post={p}
            nowMs={nowMs}
            onReact={(kind) => react.mutate({ postId: p.id, kind })}
            onComment={() => setCommentsFor(p.id)}
            onOpenProfile={(uid) => router.push(`/athlete/${uid}` as never)}
            canDelete={p.authorId === myId}
            onDelete={() => del.mutate(p)}
            onReport={p.authorId === myId ? undefined : () => setReportFor(p.id)}
          />
        )}
      />

      {composerOpen ? <CreatePostModal onClose={() => setComposerOpen(false)} /> : null}
      {commentsFor ? <CommentsModal postId={commentsFor} onClose={() => setCommentsFor(null)} /> : null}
      {reportFor ? <ReportSheet postId={reportFor} onClose={() => setReportFor(null)} /> : null}
      {notifOpen ? (
        <NotificationsModal onClose={() => setNotifOpen(false)} onOpenFriends={() => { setNotifOpen(false); router.push('/friends' as never); }} />
      ) : null}
    </>
  );
}

/** The horizontal friends activity row + a Find Friends tile. */
/** §6.3: pre-username accounts claim theirs here — browsing stays open,
 *  posting waits until a unique name exists. Saved PRIVATE (name only);
 *  going public stays a separate choice on Rank. */
function ClaimNameCard() {
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const save = useSavePublicIdentity();
  const problem = name.trim() ? nameError(name) : null;
  return (
    <GlowCard glow={colors.legendary}>
      <Text className="mb-s1 text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
        CLAIM YOUR NAME
      </Text>
      <Text className="mb-s2 text-2xs text-text-mute">
        Social runs on usernames now. Pick a unique one to post, comment and be found — it does
        NOT put you on the leaderboard.
      </Text>
      <TextInput
        className="mb-s2 min-h-[48px] rounded-md border border-border bg-surface-2 px-s3 text-base text-text"
        placeholder="3–24 characters, unique"
        placeholderTextColor="#64758f"
        autoCapitalize="none"
        value={name}
        onChangeText={setName}
        maxLength={24}
        testID="claim-name-input"
      />
      {problem ? <Text className="mb-s2 text-2xs text-warn">{problem}</Text> : null}
      <NeonButton
        title="CLAIM"
        onPress={() => save.mutate({ displayName: name.trim(), isPublic: false })}
        disabled={name.trim() === '' || problem !== null}
        busy={save.isPending}
        testID="claim-name-save"
      />
    </GlowCard>
  );
}

function FriendsRow() {
  const colors = useThemeColors();
  const friends = useFriends();
  const list = friends.data ?? [];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
      {list.map((f) => (
        <Pressable
          key={f.id}
          onPress={() => router.push(`/athlete/${f.id}` as never)}
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

/** DISCOVER — public, discoverable athletes to add (migration 055). Each row
 *  taps through to the athlete's profile; the chip sends an id-based request. */
function DiscoverAthletes() {
  const colors = useThemeColors();
  const discover = useDiscoverAthletes();
  const list = discover.data ?? [];
  if (discover.isPending) return null;
  if (list.length === 0) {
    return (
      <View className="rounded-lg border p-s3" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.4)' }}>
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>ATHLETES TO DISCOVER</Text>
        <Text className="mt-s2 text-2xs text-text-dim">No public athletes yet. Make your own profile discoverable in Settings to appear here.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>ATHLETES TO DISCOVER</Text>
      {list.map((a) => (
        <Pressable
          key={a.user_id}
          onPress={() => router.push(`/athlete/${a.user_id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`${a.display_name}'s profile`}
          testID={`discover-${a.user_id}`}
          className="flex-row items-center rounded-lg border p-s3"
          style={{ borderColor: `${colors.epic}33`, backgroundColor: 'rgba(13,21,36,0.5)', gap: 10 }}
        >
          <View className="items-center justify-center rounded-lg border" style={{ width: 40, height: 40, borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.08)' }}>
            <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.epic, ...pixelFont() }}>{(a.display_name[0] ?? 'A').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="text-sm font-bold text-text" numberOfLines={1}>{a.display_name}</Text>
            <Text className="text-2xs text-text-mute">{a.forge_level != null ? `Forge Lv. ${a.forge_level}` : 'Athlete'}{a.rank != null ? ` · Rank ${a.rank}` : ''}</Text>
          </View>
          <AddFriendButton athleteId={a.user_id} testID={`discover-add-${a.user_id}`} />
        </Pressable>
      ))}
    </View>
  );
}

/** RIVALS — the head-to-head records with friends (migration 036). Active
 *  rivalries (any contest) rise to the top; a friend with no contests yet is a
 *  rivalry waiting to happen. Contests are recorded server-side by the Arena. */
function RivalriesView() {
  const colors = useThemeColors();
  const friends = useFriends();
  if (friends.isPending) return <FeedSkeleton />;
  const list = [...(friends.data ?? [])].sort(
    (a, b) => b.my_wins + b.their_wins + b.draws - (a.my_wins + a.their_wins + a.draws)
  );
  if (list.length === 0) return <EmptyState scope="rivals" />;
  const anyContest = list.some((f) => f.my_wins + f.their_wins + f.draws > 0);

  return (
    <View style={{ gap: 10 }}>
      {!anyContest ? (
        <Text className="text-2xs text-text-mute">
          No contests yet — battle a friend in the Arena and your head-to-head record starts here.
        </Text>
      ) : null}
      {list.map((f) => {
        const total = f.my_wins + f.their_wins + f.draws;
        const lead = f.my_wins > f.their_wins ? 'up' : f.my_wins < f.their_wins ? 'down' : 'even';
        const col = lead === 'up' ? colors.success : lead === 'down' ? colors.danger : colors['text-dim'];
        return (
          <Pressable
            key={f.id}
            onPress={() => router.push(`/athlete/${f.id}` as never)}
            accessibilityRole="button"
            className="flex-row items-center rounded-lg border p-s3"
            style={{ borderColor: total > 0 ? `${col}45` : colors.border, backgroundColor: 'rgba(13,21,36,0.5)', gap: 10 }}
            testID={`rival-${f.id}`}
          >
            <View className="items-center justify-center rounded-lg border" style={{ width: 40, height: 40, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.08)' }}>
              <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.accent, ...pixelFont() }}>{(f.display_name[0] ?? 'A').toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-sm font-bold text-text" numberOfLines={1}>{f.display_name}</Text>
              <Text className="text-2xs text-text-mute">{total > 0 ? `${total} contest${total > 1 ? 's' : ''}` : 'No contests yet'}</Text>
            </View>
            <Text allowFontScaling={false} style={{ fontSize: 16, color: col, ...pixelFont() }}>
              {f.my_wins}–{f.their_wins}{f.draws > 0 ? `–${f.draws}` : ''}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => router.push('/friends' as never)}
        accessibilityRole="button"
        testID="rivals-challenge"
        className="items-center justify-center rounded-lg border py-s3"
        style={{ borderColor: `${colors.accent}8c`, minHeight: 44 }}
      >
        <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, ...pixelFont(false) }}>CHALLENGE A FRIEND ›</Text>
      </Pressable>
    </View>
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
