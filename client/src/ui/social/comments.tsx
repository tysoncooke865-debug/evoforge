import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useAddComment, usePostComments } from '@/data/social-feed';
import { relativeTime } from '@/domain/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * COMMENTS — a post's thread (read via the 050 visibility-checked RPC) plus a
 * composer (insert under the caller's own RLS). Optimistic-free but snappy:
 * sending invalidates the thread + the feed's comment count.
 */
export function CommentsModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const colors = useThemeColors();
  const [nowMs] = useState(() => Date.now());
  const [body, setBody] = useState('');
  const comments = usePostComments(postId);
  const add = useAddComment();
  const list = comments.data ?? [];

  const send = () => {
    const b = body.trim();
    if (b === '') return;
    add.mutate({ postId, body: b }, { onSuccess: () => setBody('') });
  };

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
              ) : list.length === 0 ? (
                <Text className="py-s4 text-center text-2xs text-text-mute">No comments yet — be the first.</Text>
              ) : (
                list.map((c) => (
                  <View key={c.id} className="mb-s3 flex-row" style={{ gap: 10 }} testID={`comment-row-${c.id}`}>
                    <View className="items-center justify-center rounded-lg border" style={{ width: 34, height: 34, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.08)' }}>
                      <Text allowFontScaling={false} style={{ fontSize: 15, color: colors.accent, ...pixelFont() }}>{(c.author_name[0] ?? 'A').toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text className="text-2xs text-text-mute">
                        <Text className="font-bold text-text">{c.author_name}</Text> · {relativeTime(c.created_at, nowMs)}
                      </Text>
                      <Text className="mt-s1 text-sm text-text-dim">{c.body}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View className="mt-s2 flex-row items-end gap-s2">
              <TextInput
                className="min-h-[48px] flex-1 rounded-md border bg-surface-2 px-s3 text-base text-text"
                style={{ borderColor: `${colors.accent}59` }}
                placeholder="Add a comment…"
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
