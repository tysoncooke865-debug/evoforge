import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useFriendCode, useFriends, useFriendRequests, useRespondRequest, useSendFriendRequest } from '@/data/social';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell, GlowCard } from '@/ui/core/shell';

/**
 * FRIENDS + RIVALS (Tyson, 2026-07-17) — migration 036. Add by code, share
 * yours, accept invites, see the head-to-head record with each rival. The hub
 * the social game modes plug into (ghost battles, damage assessment, live
 * matchmaking — MULTIPLAYER_ROADMAP.md).
 */
export default function FriendsScreen() {
  const colors = useThemeColors();
  const code = useFriendCode();
  const friends = useFriends();
  const requests = useFriendRequests();
  const send = useSendFriendRequest();
  const respond = useRespondRequest();
  const [entry, setEntry] = useState('');

  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title="FRIENDS & RIVALS" onBack={() => router.back()} />

      {/* Your code + add by code. */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, letterSpacing: 1.5, ...pixelFont(false) }}>
          YOUR ADD CODE
        </Text>
        <Text selectable allowFontScaling={false} style={{ marginTop: 4, fontSize: 34, color: colors.text, letterSpacing: 8, ...pixelFont() }} testID="my-friend-code">
          {code.data ?? '······'}
        </Text>
        <Text className="mt-s1 text-2xs text-text-mute">Share it so friends can add you. Enter theirs below.</Text>

        <TextInput
          className="mt-s3 min-h-[50px] rounded-xl border bg-surface-2 px-s3 text-center text-xl font-bold text-text"
          style={{ letterSpacing: 8, borderColor: entry.trim().length === 6 ? `${colors.accent}8c` : colors.border }}
          placeholder="——————"
          placeholderTextColor="#64758f"
          autoCapitalize="characters"
          maxLength={6}
          value={entry}
          onChangeText={(v) => setEntry(v.toUpperCase())}
          testID="friend-code-input"
        />
        <View className="mt-s2">
          <NeonButton
            title="ADD FRIEND"
            onPress={() => send.mutate(entry, { onSuccess: (r) => { if (r.ok) setEntry(''); } })}
            busy={send.isPending}
            disabled={entry.trim().length !== 6}
            testID="friend-add"
          />
        </View>
      </GlowCard>

      {/* Pending incoming requests. */}
      {requests.data && requests.data.length > 0 ? (
        <View className="gap-s2">
          <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 1.5, ...pixelFont(false) }}>
            INVITES
          </Text>
          {requests.data.map((r) => (
            <View key={r.id} className="flex-row items-center justify-between rounded-xl border p-s3" style={{ borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.06)' }}>
              <Text className="flex-1 text-sm font-bold text-text" numberOfLines={1}>{r.display_name}</Text>
              <View className="flex-row items-center gap-s2">
                <Pressable onPress={() => respond.mutate({ id: r.id, accept: false })} accessibilityRole="button" testID={`invite-decline-${r.id}`} className="items-center justify-center px-s2" style={{ minHeight: 40 }}>
                  <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>DECLINE</Text>
                </Pressable>
                <Pressable onPress={() => respond.mutate({ id: r.id, accept: true })} accessibilityRole="button" testID={`invite-accept-${r.id}`} className="rounded-lg px-s3" style={{ minHeight: 40, justifyContent: 'center', backgroundColor: colors.accent }}>
                  <Text className="text-2xs font-bold text-accent-ink" style={{ letterSpacing: 1 }}>ACCEPT</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Friends + rival record. */}
      <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], letterSpacing: 1.5, ...pixelFont(false) }}>
        YOUR RIVALS
      </Text>
      {friends.data && friends.data.length > 0 ? (
        friends.data.map((f) => {
          const lead = f.my_wins > f.their_wins ? 'up' : f.my_wins < f.their_wins ? 'down' : 'even';
          const col = lead === 'up' ? colors.success : lead === 'down' ? colors.danger : colors['text-dim'];
          return (
            <View key={f.id} className="flex-row items-center justify-between rounded-xl border border-border p-s3" style={{ backgroundColor: 'rgba(13,21,36,0.4)' }} testID={`friend-${f.id}`}>
              <Text className="flex-1 text-sm font-bold text-text" numberOfLines={1}>{f.display_name}</Text>
              <Text allowFontScaling={false} style={{ fontSize: 13, color: col, ...pixelFont() }}>
                {f.my_wins}–{f.their_wins}{f.draws > 0 ? `–${f.draws}` : ''}
              </Text>
            </View>
          );
        })
      ) : (
        <Text className="py-s3 text-center text-2xs text-text-mute">No rivals yet — share your code and add a friend.</Text>
      )}
    </ScreenShell>
  );
}
