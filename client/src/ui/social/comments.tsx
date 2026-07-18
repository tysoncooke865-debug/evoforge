import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useAddComment, usePostComments, useToggleCommentReaction, type CommentRow } from '@/data/social-feed';
import { groupCommentThreads, relativeTime, type ReactionKind } from '@/domain/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { CommentReactionRow } from '@/ui/social/reaction-bar';

/**
 * COMMENTS — a post's thread (read via the 058-shaped RPC: parent_id +
 * reaction counts) plus a composer. §6.1 (2026-07-19): comments carry the
 * SAME four reactions as posts and take one-level replies — tap ↩ REPLY,
 * the composer retargets (a chip shows who, ✕ cancels back to the post).
 */
export function CommentsModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const colors = useThemeColors();
  const [nowMs] = useState(() => Date.now());
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const comments = usePostComments(postId);
  const add = useAddComment();
  const react = useToggleCommentReaction();
  const threads = groupCommentThreads(comments.data ?? []);

  const send = () => {
    const b = body.trim();
    if (b === '') return;
    add.mutate(
      { postId, body: b, parentId: replyTo?.id ?? null },
      {
        onSuccess: () => {
          setBody('');
          setReplyTo(null);
        },
      }
    );
  };
  const onReact = (commentId: string, kind: ReactionKind) => react.mutate({ postId, commentId, kind });

  const Row = ({ c, isReply }: { c: CommentRow; isReply: boolean }) => (
    <View className="mb-s3 flex-row" style={{ gap: 10, marginLeft: isReply ? 34 : 0 }} testID={`comment-row-${c.id}`}>
      <View
        className="items-center justify-center rounded-lg border"
        style={{
          width: isReply ? 26 : 34,
          height: isReply ? 26 : 34,
          borderColor: `${colors.accent}59`,
          backgroundColor: 'rgba(34,211,238,0.08)',
        }}
      >
        <Text allowFontScaling={false} style={{ fontSize: isReply ? 12 : 15, color: colors.accent, ...pixelFont() }}>
          {(c.author_name[0] ?? 'A').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-2xs text-text-mute">
          <Text className="font-bold text-text">{c.author_name}</Text> · {relativeTime(c.created_at, nowMs)}
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">{c.body}</Text>
        <CommentReactionRow
          commentId={c.id}
          myReaction={c.my_reaction}
          reactionCount={c.reaction_count}
          onReact={(k) => onReact(c.id, k)}
          onReply={isReply ? undefined : () => setReplyTo(c)}
        />
      </View>
    </View>
  );

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable onPress={() => undefined} className="overflow-hidden rounded-t-xl border-t" style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: '82%' }}>
          <View className="p-s4">
            <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}>
              COMMENTS
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {comments.isPending ? (
                <View className="items-center py-s4"><ActivityIndicator color={colors.accent} /></View>
              ) : threads.length === 0 ? (
                <Text className="py-s4 text-center text-2xs text-text-mute">No comments yet — be the first.</Text>
              ) : (
                threads.map(({ top, replies }) => (
                  <View key={top.id}>
                    <Row c={top} isReply={false} />
                    {replies.map((r) => (
                      <Row key={r.id} c={r} isReply />
                    ))}
                  </View>
                ))
              )}
            </ScrollView>

            {replyTo ? (
              <View className="mt-s1 flex-row items-center rounded-pill border px-s2" style={{ alignSelf: 'flex-start', minHeight: 28, gap: 6, borderColor: `${colors.accent}59` }}>
                <Text className="text-2xs text-accent" numberOfLines={1}>
                  ↩ Replying to {replyTo.author_name}
                </Text>
                <Pressable
                  onPress={() => setReplyTo(null)}
                  accessibilityRole="button"
                  accessibilityLabel="cancel reply"
                  testID="comment-reply-cancel"
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Text className="text-2xs text-text-mute">✕</Text>
                </Pressable>
              </View>
            ) : null}

            <View className="mt-s2 flex-row items-end gap-s2">
              <TextInput
                className="min-h-[48px] flex-1 rounded-md border bg-surface-2 px-s3 text-base text-text"
                style={{ borderColor: `${colors.accent}59` }}
                placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : 'Add a comment…'}
                placeholderTextColor="#64758f"
                value={body}
                onChangeText={setBody}
                maxLength={500}
                testID="comment-input"
              />
              <View style={{ width: 84 }}>
                <NeonButton title="SEND" onPress={send} busy={add.isPending} disabled={body.trim() === ''} testID="comment-send" />
              </View>
            </View>
            <View className="mt-s2">
              <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="comment-close" />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
