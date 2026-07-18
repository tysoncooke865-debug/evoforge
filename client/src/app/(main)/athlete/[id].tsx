import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useAthleteProfile, useAthletePosts, type EvoPillar } from '@/data/social-profile';
import { useDeletePost, useToggleReaction } from '@/data/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { AddFriendButton } from '@/ui/social/add-friend-button';
import { CommentsModal } from '@/ui/social/comments';
import { SocialPostCard } from '@/ui/social/post-cards';

/**
 * ATHLETE PROFILE — another athlete's public face: identity, Forge Level, Evo
 * pillars, lifts and bodyweight (each shown ONLY when they opted in — the 055
 * RPC gates every field), your head-to-head record, and their posts you may
 * see. A private profile you're not friends with shows a locked card with an
 * add-friend path. Never invents a stat: a hidden block simply doesn't render.
 */
export default function AthleteProfileScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const athleteId = typeof id === 'string' ? id : null;
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;
  const [nowMs] = useState(() => Date.now());
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  const profile = useAthleteProfile(athleteId);
  const p = profile.data;
  const canView = p?.can_view ?? false;
  const posts = useAthletePosts(athleteId, canView);
  const react = useToggleReaction();
  const del = useDeletePost();
  const list = posts.data?.pages.flat() ?? [];

  const title = (p?.display_name ?? 'ATHLETE').toUpperCase();

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="THE GUILD"
        title={title}
        right={
          <Pressable onPress={() => router.back()} accessibilityRole="button" testID="athlete-back" className="items-center justify-center rounded-lg border p-s2" style={{ minHeight: 44, minWidth: 44, borderColor: `${colors.accent}59` }}>
            <Text style={{ fontSize: 16, color: colors.accent }}>‹</Text>
          </Pressable>
        }
      />

      {profile.isPending ? (
        <GlowCard>
          <View className="items-center py-s5">
            <Text className="text-2xs text-text-mute">Loading…</Text>
          </View>
        </GlowCard>
      ) : !p || p.ok === false ? (
        <GlowCard>
          <View className="items-center py-s5">
            <Text className="text-sm text-text-dim">Athlete not found.</Text>
          </View>
        </GlowCard>
      ) : !canView ? (
        <GlowCard glow={colors.epic}>
          <View className="items-center py-s5">
            <View className="items-center justify-center rounded-lg border" style={{ width: 56, height: 56, borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.08)' }}>
              <Text allowFontScaling={false} style={{ fontSize: 24, color: colors.epic, ...pixelFont() }}>{(p.display_name[0] ?? 'A').toUpperCase()}</Text>
            </View>
            <Text className="mt-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 1, ...pixelFont() }}>🔒 PRIVATE PROFILE</Text>
            <Text className="mt-s2 max-w-[280px] text-center text-2xs text-text-dim">Add {p.display_name} as a friend to see their forge, stats and posts.</Text>
            {athleteId ? <View className="mt-s3"><AddFriendButton athleteId={athleteId} /></View> : null}
          </View>
        </GlowCard>
      ) : (
        <>
          {/* Identity + head-to-head. */}
          <GlowCard glow={colors.accent}>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className="items-center justify-center rounded-xl border" style={{ width: 60, height: 60, borderColor: `${colors.accent}8c`, backgroundColor: 'rgba(34,211,238,0.1)' }}>
                <Text allowFontScaling={false} style={{ fontSize: 26, color: colors.accent, ...pixelFont() }}>{(p.display_name[0] ?? 'A').toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-base font-bold text-text" numberOfLines={1}>{p.display_name}</Text>
                <Text className="text-2xs text-text-mute">
                  {p.forge_level != null ? `Forge Lv. ${p.forge_level}` : 'Athlete'}
                  {p.are_friends ? ' · Friend' : ''}{p.post_count != null ? ` · ${p.post_count} post${p.post_count === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
              {!p.is_self && athleteId && !p.are_friends ? <AddFriendButton athleteId={athleteId} /> : null}
            </View>

            {p.rival && (p.rival.my_wins + p.rival.their_wins + p.rival.draws) > 0 ? (
              <View className="mt-s3 flex-row items-center justify-between rounded-lg border p-s3" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}>
                <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>HEAD-TO-HEAD</Text>
                <Text allowFontScaling={false} style={{ fontSize: 16, color: p.rival.my_wins > p.rival.their_wins ? colors.success : p.rival.my_wins < p.rival.their_wins ? colors.danger : colors['text-dim'], ...pixelFont() }}>
                  {p.rival.my_wins}–{p.rival.their_wins}{p.rival.draws > 0 ? `–${p.rival.draws}` : ''}
                </Text>
              </View>
            ) : null}
          </GlowCard>

          {/* Evo pillars — only if the athlete shows them. */}
          {p.evo ? (
            <GlowCard glow={colors.epic}>
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>EVO PROFILE{p.evo.class ? ` · ${p.evo.class.toUpperCase()}` : ''}{p.evo.rank != null ? ` · RANK ${p.evo.rank}` : ''}</Text>
              <View className="mt-s3 flex-row flex-wrap" style={{ gap: 14 }}>
                {p.evo.pillars.map((pl: EvoPillar) => (
                  <View key={pl.label} style={{ minWidth: 64 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 20, color: colors.epic, ...pixelFont() }}>{Math.round(pl.value)}</Text>
                    <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 7, letterSpacing: 1, ...pixelFont(false) }}>{pl.label}</Text>
                  </View>
                ))}
              </View>
            </GlowCard>
          ) : null}

          {/* Lifts + bodyweight — sensitive, shown only on opt-in. */}
          {p.lifts || p.bodyweight != null ? (
            <GlowCard>
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>STRENGTH</Text>
              <View className="mt-s3 flex-row flex-wrap" style={{ gap: 16 }}>
                {p.lifts?.bench != null ? <StatTile value={`${Math.round(p.lifts.bench)}`} unit={p.lifts.unit} label="BENCH e1RM" /> : null}
                {p.lifts?.squat != null ? <StatTile value={`${Math.round(p.lifts.squat)}`} unit={p.lifts.unit} label="SQUAT e1RM" /> : null}
                {p.lifts?.deadlift != null ? <StatTile value={`${Math.round(p.lifts.deadlift)}`} unit={p.lifts.unit} label="DEADLIFT e1RM" /> : null}
                {p.bodyweight != null ? <StatTile value={`${Math.round(p.bodyweight)}`} unit="kg" label="BODYWEIGHT" /> : null}
              </View>
            </GlowCard>
          ) : null}

          {/* Their posts. */}
          <Text className="mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>POSTS</Text>
          {posts.isPending ? (
            <Text className="py-s4 text-center text-2xs text-text-mute">Loading…</Text>
          ) : list.length === 0 ? (
            <Text className="py-s4 text-center text-2xs text-text-mute">No posts to show yet.</Text>
          ) : (
            <View style={{ gap: 14 }}>
              {list.map((post) => (
                <SocialPostCard
                  key={post.id}
                  post={post}
                  nowMs={nowMs}
                  onReact={(kind) => react.mutate({ postId: post.id, kind })}
                  onComment={() => setCommentsFor(post.id)}
                  onOpenProfile={(uid) => { if (uid !== athleteId) router.push(`/athlete/${uid}` as never); }}
                  canDelete={post.authorId === myId}
                  onDelete={() => del.mutate(post)}
                />
              ))}
              {posts.hasNextPage ? (
                <Pressable onPress={() => void posts.fetchNextPage()} accessibilityRole="button" testID="athlete-more" className="items-center justify-center rounded-lg border py-s3" style={{ borderColor: colors.border, minHeight: 44 }}>
                  <Text className="text-2xs text-text-dim" style={{ letterSpacing: 1 }}>{posts.isFetchingNextPage ? 'LOADING…' : 'LOAD MORE'}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </>
      )}

      {commentsFor ? <CommentsModal postId={commentsFor} onClose={() => setCommentsFor(null)} /> : null}
    </ScreenShell>
  );
}

function StatTile({ value, unit, label }: { value: string; unit: string; label: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ minWidth: 72 }}>
      <Text allowFontScaling={false} style={{ fontSize: 18, color: colors.text, ...pixelFont() }}>
        {value}<Text className="text-text-mute" style={{ fontSize: 10 }}> {unit}</Text>
      </Text>
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 7, letterSpacing: 1, ...pixelFont(false) }}>{label}</Text>
    </View>
  );
}
