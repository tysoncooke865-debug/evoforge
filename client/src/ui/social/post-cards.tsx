import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useSignedPhotoUrls } from '@/data/social-photos';
import {
  relativeTime,
  type EvoRatingPost,
  type EvolutionPost,
  type LevelUpPost,
  type PhotoPost,
  type PRPost,
  type ReactionKind,
  type RivalryPost,
  type SocialPost,
  type WorkoutPost,
} from '@/domain/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';
import { SocialReactionBar } from '@/ui/social/reaction-bar';

/**
 * SOCIAL post cards — one shared shell (portrait, identity, time, visibility,
 * caption, reactions + contextual action) with a per-type body. Every number
 * is from the post's own validated payload; the shell never invents a stat.
 * Prestige types (PR, level-up, evolution) glow; the rest stay quiet — the
 * "restrained game HUD, not emoji spam" rule.
 */
export function SocialPostCard({
  post,
  nowMs,
  onReact,
  onComment,
  canDelete = false,
  onDelete,
}: {
  post: SocialPost;
  nowMs: number;
  onReact: (kind: ReactionKind) => void;
  onComment: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const colors = useThemeColors();
  const glow =
    post.type === 'pr' || post.type === 'evolution'
      ? colors.legendary
      : post.type === 'level_up'
        ? colors.accent
        : post.type === 'evo_rating'
          ? colors.epic
          : undefined;

  return (
    <GlowCard glow={glow} padding={16}>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <Portrait name={post.authorName} tint={glow ?? colors.accent} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-sm font-bold text-text" numberOfLines={1}>
            {post.authorName}
          </Text>
          <Text className="text-2xs text-text-mute" numberOfLines={1}>
            {actionVerb(post)} · {relativeTime(post.createdAt, nowMs)}
            {post.visibility !== 'friends' ? ` · ${post.visibility}` : ''}
          </Text>
        </View>
        {canDelete ? (
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="delete this post"
            testID={`post-delete-${post.id}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="items-center justify-center"
            style={{ minWidth: 32, minHeight: 32 }}
          >
            <Text className="text-sm text-text-mute">⋯</Text>
          </Pressable>
        ) : null}
      </View>

      {post.type === 'status' ? null : (
        <View className="mt-s3">
          <PostBody post={post} />
        </View>
      )}

      {post.caption ? (
        <Text className={post.type === 'status' ? 'mt-s3 text-base text-text' : 'mt-s2 text-sm text-text-dim'}>
          {post.caption}
        </Text>
      ) : null}

      <SocialReactionBar post={post} onReact={onReact} onComment={onComment} />
    </GlowCard>
  );
}

/** A per-user avatar tile — the author's initial on a tinted plate (we never
 *  fake another athlete's champion sprite; the initial is honest identity). */
function Portrait({ name, tint }: { name: string; tint: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="items-center justify-center rounded-lg border"
      style={{ width: 42, height: 42, borderColor: `${tint}8c`, backgroundColor: `${tint}1a` }}
    >
      <Text allowFontScaling={false} style={{ fontSize: 18, color: tint, ...pixelFont() }}>
        {(name[0] ?? 'A').toUpperCase()}
      </Text>
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: 8, backgroundColor: colors['bg-deep'] }} />
    </View>
  );
}

function actionVerb(post: SocialPost): string {
  switch (post.type) {
    case 'pr': return 'hit a new PR';
    case 'workout': return 'completed a workout';
    case 'level_up': return 'levelled up';
    case 'evo_rating': return 'raised their Evo Rating';
    case 'evolution': return 'evolved';
    case 'rivalry': return 'rivalry update';
    case 'photo': return 'posted';
    case 'status': return 'posted an update';
  }
}

function PostBody({ post }: { post: SocialPost }) {
  switch (post.type) {
    case 'pr': return <PRBody p={post} />;
    case 'workout': return <WorkoutBody p={post} />;
    case 'level_up': return <LevelUpBody p={post} />;
    case 'evo_rating': return <EvoRatingBody p={post} />;
    case 'evolution': return <EvolutionBody p={post} />;
    case 'rivalry': return <RivalryBody p={post} />;
    case 'photo': return <PhotoBody p={post} />;
    case 'status': return null; // the caption is the content (rendered by the shell)
  }
}

const Kicker = ({ text, tint }: { text: string; tint: string }) => (
  <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, color: tint, ...pixelFont(false) }}>
    {text}
  </Text>
);

function PRBody({ p }: { p: PRPost }) {
  const colors = useThemeColors();
  const delta = p.prevValue == null ? null : Math.round((p.newValue - p.prevValue) * 10) / 10;
  return (
    <View className="rounded-lg border p-s3" style={{ borderColor: `${colors.legendary}45`, backgroundColor: `${colors.legendary}0f` }}>
      <Kicker text="NEW PERSONAL RECORD" tint={colors.legendary} />
      <Text className="mt-s1 text-sm font-bold text-text" numberOfLines={1}>{p.exercise.toUpperCase()}</Text>
      <View className="mt-s1 flex-row items-baseline" style={{ gap: 8 }}>
        <Text allowFontScaling={false} style={{ fontSize: 30, color: colors.legendary, textShadowColor: `${colors.legendary}8c`, textShadowRadius: 12, ...pixelFont() }}>
          {p.newValue}
          <Text className="text-text-mute" style={{ fontSize: 13 }}> {p.unit}</Text>
        </Text>
        {delta != null && delta > 0 ? (
          <Text allowFontScaling={false} style={{ fontSize: 13, color: colors.success, ...pixelFont() }}>+{delta} {p.unit}</Text>
        ) : null}
      </View>
      {p.prevValue != null ? <Text className="mt-s1 text-2xs text-text-mute">Previous: {p.prevValue} {p.unit}</Text> : null}
      {p.standing ? <Text className="mt-s1 text-2xs text-legendary">★ {p.standing}</Text> : null}
    </View>
  );
}

function StatTile({ value, label, tint }: { value: string; label: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ minWidth: 62 }}>
      <Text allowFontScaling={false} style={{ fontSize: 16, color: tint ?? colors.text, ...pixelFont() }}>{value}</Text>
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 7, letterSpacing: 1, ...pixelFont(false) }}>{label}</Text>
    </View>
  );
}

function WorkoutBody({ p }: { p: WorkoutPost }) {
  const colors = useThemeColors();
  const shown = p.exercises.slice(0, 3);
  const more = p.exercises.length - shown.length;
  return (
    <View>
      <Text className="text-sm font-bold text-text" numberOfLines={1}>{p.workoutName.toUpperCase()}</Text>
      <View className="mt-s2 flex-row flex-wrap" style={{ gap: 12 }}>
        <StatTile value={`${p.minutes}`} label="MIN" />
        <StatTile value={`${p.sets}`} label="SETS" />
        <StatTile value={p.volumeKg.toLocaleString()} label="KG VOL" />
        {p.prCount > 0 ? <StatTile value={`${p.prCount}`} label="PRs" tint={colors.legendary} /> : null}
        <StatTile value={`+${p.xp}`} label="XP" tint={colors.accent} />
      </View>
      {shown.length > 0 ? (
        <Text className="mt-s2 text-2xs text-text-mute" numberOfLines={1}>
          {shown.join(' · ')}{more > 0 ? ` +${more} more` : ''}
        </Text>
      ) : null}
      {p.photoUrls.length > 0 ? <PhotoStrip urls={p.photoUrls} /> : null}
    </View>
  );
}

function LevelUpBody({ p }: { p: LevelUpPost }) {
  const colors = useThemeColors();
  return (
    <View className="items-center rounded-lg border p-s3" style={{ borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.06)' }}>
      <Kicker text="REACHED FORGE LEVEL" tint={colors.accent} />
      <Text allowFontScaling={false} style={{ fontSize: 40, color: colors.accent, textShadowColor: `${colors.accent}8c`, textShadowRadius: 16, ...pixelFont() }}>
        {p.newLevel}
      </Text>
      <Text className="text-2xs text-text-mute">LV. {p.prevLevel} → {p.newLevel}{p.streakDays ? ` · ${p.streakDays}d streak` : ''}</Text>
      {p.reward ? <Text className="mt-s1 text-2xs text-legendary">Unlocked: {p.reward}</Text> : null}
    </View>
  );
}

function EvoRatingBody({ p }: { p: EvoRatingPost }) {
  const colors = useThemeColors();
  return (
    <View className="rounded-lg border p-s3" style={{ borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}>
      <Kicker text="EVO RATING INCREASED" tint={colors.epic} />
      <View className="mt-s1 flex-row items-baseline" style={{ gap: 8 }}>
        <Text allowFontScaling={false} style={{ fontSize: 26, color: colors.epic, ...pixelFont() }}>{p.prevRating} → {p.newRating}</Text>
      </View>
      <View className="mt-s2 flex-row flex-wrap" style={{ gap: 10 }}>
        {p.pillars.filter((x) => x.delta !== 0).map((x) => (
          <Text key={x.label} allowFontScaling={false} style={{ fontSize: 11, color: x.delta > 0 ? colors.success : colors.danger, ...pixelFont() }}>
            {x.label} {x.delta > 0 ? '+' : ''}{x.delta}
          </Text>
        ))}
      </View>
    </View>
  );
}

function EvolutionBody({ p }: { p: EvolutionPost }) {
  const colors = useThemeColors();
  const roman = (n: number) => ['0', 'I', 'II', 'III', 'IV'][n] ?? String(n);
  return (
    <View className="items-center rounded-lg border p-s4" style={{ borderColor: `${colors.legendary}59`, backgroundColor: `${colors.legendary}0f` }}>
      <Kicker text="CHARACTER EVOLUTION" tint={colors.legendary} />
      <Text className="mt-s1 text-sm font-bold text-text">{p.path.toUpperCase()}</Text>
      <Text allowFontScaling={false} style={{ fontSize: 22, color: colors.legendary, textShadowColor: `${colors.legendary}8c`, textShadowRadius: 14, ...pixelFont() }}>
        STAGE {roman(p.prevStage)} → {roman(p.newStage)}
      </Text>
    </View>
  );
}

function RivalryBody({ p }: { p: RivalryPost }) {
  const colors = useThemeColors();
  return (
    <View className="rounded-lg border p-s3" style={{ borderColor: `${colors.rare}45`, backgroundColor: 'rgba(56,189,248,0.06)' }}>
      <Kicker text={`VS ${p.opponentName.toUpperCase()}`} tint={colors.rare} />
      <View className="mt-s2" style={{ gap: 4 }}>
        {p.categories.map((c) => (
          <View key={c.label} className="flex-row items-center justify-between">
            <Text className="text-2xs text-text-mute">{c.label.toUpperCase()}</Text>
            <Text allowFontScaling={false} style={{ fontSize: 11, color: c.lead === 'me' ? colors.success : c.lead === 'them' ? colors.danger : colors['text-dim'], ...pixelFont() }}>
              {c.lead === 'me' ? 'YOU' : c.lead === 'them' ? p.opponentName : 'EVEN'}{c.detail ? ` · ${c.detail}` : ''}
            </Text>
          </View>
        ))}
      </View>
      {p.objective ? <Text className="mt-s2 text-2xs text-text-dim">Objective: {p.objective}</Text> : null}
    </View>
  );
}

function PhotoBody({ p }: { p: PhotoPost }) {
  return (
    <View>
      <PhotoStrip urls={p.photoUrls} />
      {p.workoutName ? (
        <Text className="mt-s2 text-2xs text-text-mute">
          {p.workoutName.toUpperCase()}{p.minutes ? ` · ${p.minutes} min` : ''}{p.sets ? ` · ${p.sets} sets` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/** The photo carousel — resolves storage paths to short-lived signed URLs and
 *  renders them; a single photo fills the width, several scroll horizontally. */
function PhotoStrip({ urls }: { urls: string[] }) {
  const colors = useThemeColors();
  const signed = useSignedPhotoUrls(urls);
  if (urls.length === 0) return null;
  const resolved = urls.map((p) => signed.data?.[p]).filter((u): u is string => typeof u === 'string');

  if (resolved.length === 0) {
    return (
      <View className="mt-s2 w-full items-center justify-center overflow-hidden rounded-lg" style={{ height: 180, backgroundColor: colors['surface-2'], borderWidth: 1, borderColor: colors.border }}>
        <Text className="text-2xs text-text-mute">{signed.isPending ? 'Loading photos…' : '📷 photo unavailable'}</Text>
      </View>
    );
  }
  if (resolved.length === 1) {
    return <Image source={{ uri: resolved[0] }} style={{ marginTop: 8, width: '100%', height: 220, borderRadius: 10 }} contentFit="cover" testID="post-photo" />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 8 }}>
      {resolved.map((u, i) => (
        <Image key={i} source={{ uri: u }} style={{ width: 220, height: 220, borderRadius: 10 }} contentFit="cover" testID={`post-photo-${i}`} />
      ))}
    </ScrollView>
  );
}
