import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { enablePush, pushPermission, type PushState } from '@/data/push';
import { useMarkNotificationsRead, useNotifications, type NotificationRow } from '@/data/social-notifications';
import { relativeTime } from '@/domain/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * NOTIFICATIONS — the in-app inbox (reactions, comments, friend requests).
 * Opening marks everything read (clears the badge). Rows deep-link where it
 * helps: a friend request → the Friends screen; a post reaction/comment stays
 * in the sheet (tapping could scroll the feed later).
 */
const VERB: Record<NotificationRow['type'], string> = {
  reaction: 'reacted to your post',
  comment: 'commented on your post',
  friend_request: 'sent you a friend request',
  friend_accepted: 'accepted your friend request',
};

export function NotificationsModal({ onClose, onOpenFriends }: { onClose: () => void; onOpenFriends: () => void }) {
  const colors = useThemeColors();
  const [nowMs] = useState(() => Date.now());
  const notifs = useNotifications();
  const markRead = useMarkNotificationsRead();
  const list = notifs.data ?? [];
  const [push, setPush] = useState<PushState>(() => pushPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const turnOnPush = async () => {
    setPushBusy(true);
    setPush(await enablePush());
    setPushBusy(false);
  };

  // Opening the inbox marks it read (once).
  useEffect(() => {
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If permission is already granted, make sure THIS device is actually
  // subscribed + stored (a subscription can be missing after a cache clear or
  // if granted elsewhere). Idempotent; silent.
  useEffect(() => {
    if (pushPermission() === 'granted') void enablePush().then(setPush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable onPress={() => undefined} className="overflow-hidden rounded-t-xl border-t" style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: '82%' }}>
          <View className="p-s4">
            <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}>
              NOTIFICATIONS
            </Text>

            {/* Phone push toggle — the installed PWA can receive these even when
                closed (iOS 16.4+ home-screen apps + every push-capable browser). */}
            {push !== 'unsupported' ? (
              <View className="mb-s3 flex-row items-center justify-between rounded-lg border p-s3" style={{ borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text className="text-2xs font-bold text-text">PHONE NOTIFICATIONS</Text>
                  <Text className="mt-s1 text-2xs text-text-mute">
                    {push === 'granted' ? 'On — you’ll get pushes on this device.' : push === 'denied' ? 'Blocked in your browser settings.' : 'Get pushed when friends react, comment or add you.'}
                  </Text>
                </View>
                {push === 'granted' ? (
                  <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, color: colors.success, ...pixelFont(false) }}>✓ ON</Text>
                ) : push === 'denied' ? (
                  <Text className="text-2xs text-text-mute">BLOCKED</Text>
                ) : (
                  <Pressable onPress={() => void turnOnPush()} accessibilityRole="button" testID="push-enable" disabled={pushBusy} className="items-center justify-center rounded-lg border px-s3" style={{ minHeight: 40, borderColor: `${colors.epic}8c` }}>
                    <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}>{pushBusy ? '…' : 'ENABLE'}</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {notifs.isPending ? (
                <Text className="py-s4 text-center text-2xs text-text-mute">Loading…</Text>
              ) : list.length === 0 ? (
                <Text className="py-s5 text-center text-2xs text-text-mute">Nothing yet. Reactions, comments and friend requests land here.</Text>
              ) : (
                list.map((n) => {
                  const isFriend = n.type === 'friend_request' || n.type === 'friend_accepted';
                  const tint = isFriend ? colors.epic : colors.accent;
                  return (
                    <Pressable
                      key={n.id}
                      onPress={isFriend ? onOpenFriends : undefined}
                      accessibilityRole={isFriend ? 'button' : undefined}
                      testID={`notif-${n.id}`}
                      className="mb-s2 flex-row items-center rounded-lg border p-s3"
                      style={{ gap: 10, borderColor: n.read_at ? colors.border : `${tint}59`, backgroundColor: n.read_at ? 'rgba(13,21,36,0.4)' : `${tint}0f` }}
                    >
                      <View className="items-center justify-center rounded-lg border" style={{ width: 34, height: 34, borderColor: `${tint}59`, backgroundColor: `${tint}14` }}>
                        <Text allowFontScaling={false} style={{ fontSize: 15, color: tint, ...pixelFont() }}>{(n.actor_name[0] ?? 'A').toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text className="text-2xs text-text-dim" numberOfLines={2}>
                          <Text className="font-bold text-text">{n.actor_name}</Text> {VERB[n.type]}
                          {n.post_peek ? <Text className="text-text-mute">: “{n.post_peek}”</Text> : null}
                        </Text>
                        <Text className="mt-s1 text-2xs text-text-mute">{relativeTime(n.created_at, nowMs)}</Text>
                      </View>
                      {isFriend ? <Text className="text-sm text-accent">›</Text> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={onClose} accessibilityRole="button" testID="notif-close" className="mt-s2 items-center rounded-lg border py-s3" style={{ borderColor: colors.border, minHeight: 44, justifyContent: 'center' }}>
              <Text className="text-2xs text-text-dim" style={{ letterSpacing: 1 }}>CLOSE</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
