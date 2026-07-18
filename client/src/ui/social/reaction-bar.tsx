import { Pressable, Text, View } from 'react-native';

import { REACTIONS, type PostBase, type ReactionKind } from '@/domain/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * The post action bar — HYPE is the one-tap primary; the other three
 * reactions (RESPECT / BEAST / INSPIRED) sit compact beside it, then a
 * working COMMENT button with its count. Restrained by design — a game HUD,
 * not an emoji wall. Reaction state reads by BOTH fill and label, never
 * colour alone (the accessibility rule).
 */
const LABEL: Record<ReactionKind, string> = {
  hype: 'HYPE',
  respect: 'RESPECT',
  beast: 'BEAST',
  inspired: 'INSPIRED',
};

export function SocialReactionBar({
  post,
  onReact,
  onComment,
}: {
  post: PostBase;
  onReact: (kind: ReactionKind) => void;
  onComment: () => void;
}) {
  const colors = useThemeColors();
  const active = post.myReaction;

  return (
    <View className="mt-s3 flex-row items-center border-t border-border-soft pt-s2" style={{ gap: 8 }}>
      {/* HYPE — the primary one-tap. */}
      <Pressable
        onPress={() => onReact('hype')}
        accessibilityRole="button"
        accessibilityState={{ selected: active === 'hype' }}
        accessibilityLabel={active === 'hype' ? 'Remove hype' : 'Hype this'}
        testID={`react-hype-${post.id}`}
        className="flex-row items-center rounded-pill border px-s3"
        style={{
          minHeight: 34,
          gap: 5,
          borderColor: active === 'hype' ? colors.accent : colors.border,
          backgroundColor: active === 'hype' ? 'rgba(34,211,238,0.14)' : 'transparent',
        }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, color: active === 'hype' ? colors.accent : colors['text-dim'], ...pixelFont(false) }}>
          {active === 'hype' ? '⚡ HYPED' : '⚡ HYPE'}
        </Text>
        {post.reactionCount > 0 ? (
          <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.text, ...pixelFont() }}>{post.reactionCount}</Text>
        ) : null}
      </Pressable>

      {/* The other three — compact. */}
      {REACTIONS.filter((r) => r !== 'hype').map((r) => (
        <Pressable
          key={r}
          onPress={() => onReact(r)}
          accessibilityRole="button"
          accessibilityState={{ selected: active === r }}
          accessibilityLabel={`${LABEL[r]}${active === r ? ', selected' : ''}`}
          testID={`react-${r}-${post.id}`}
          hitSlop={{ top: 8, bottom: 8 }}
          className="items-center justify-center rounded-md px-s2"
          style={{ minHeight: 34, backgroundColor: active === r ? `${colors.epic}26` : 'transparent' }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, color: active === r ? colors.epic : colors['text-mute'], ...pixelFont(false) }}>
            {LABEL[r]}
          </Text>
        </Pressable>
      ))}

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={onComment}
        accessibilityRole="button"
        accessibilityLabel={`comment${post.commentCount > 0 ? `, ${post.commentCount}` : ''}`}
        testID={`comment-${post.id}`}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        className="flex-row items-center"
        style={{ minHeight: 34, gap: 5 }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, color: colors.accent, ...pixelFont(false) }}>💬 COMMENT</Text>
        {post.commentCount > 0 ? <Text className="text-2xs text-text-mute">{post.commentCount}</Text> : null}
      </Pressable>
    </View>
  );
}
