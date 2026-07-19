import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import {
  useGymBattle,
  useGymDetail,
  useGymMessages,
  useLeaveGym,
  usePostGymMessage,
} from '@/data/gyms';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * A GYM (2026-07-19, migration 068): the roster, a private group chat (5s poll),
 * gym-vs-gym battles decided by aggregate roster Evo Rating, and leave/disband.
 * Everything is membership-gated server-side — a non-member gets can_view:false.
 */
export default function GymScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = typeof id === 'string' ? id : null;
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;

  const detail = useGymDetail(gymId);
  const messages = useGymMessages(gymId);
  const post = usePostGymMessage();
  const battle = useGymBattle();
  const leave = useLeaveGym();

  const [msg, setMsg] = useState('');
  const [oppCode, setOppCode] = useState('');

  const d = detail.data;
  const gym = d?.gym;

  const send = () => {
    const body = msg.trim();
    if (!body || !gymId) return;
    setMsg('');
    post.mutate({ gymId, body });
  };

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="GYM"
        title={(gym?.name ?? 'GYM').toUpperCase()}
        titleLines={2}
        onBack={() => router.replace('/social' as never)}
      />

      {detail.isPending ? (
        <Text className="py-s5 text-center text-2xs text-text-mute">Loading…</Text>
      ) : !d || d.can_view === false || !gym ? (
        <GlowCard>
          <Text className="py-s4 text-center text-sm text-text-dim">
            This gym is private — join it to see inside.
          </Text>
        </GlowCard>
      ) : (
        <>
          {/* Roster + power. */}
          <GlowCard glow={colors.accent}>
            <View className="flex-row items-center justify-between">
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
                ROSTER · {gym.my_role === 'owner' ? 'YOU OWN THIS' : 'MEMBER'}
              </Text>
              <Text allowFontScaling={false} style={{ fontSize: 13, color: colors.accent, ...pixelFont() }}>
                ⚡ {gym.roster_power} POWER
              </Text>
            </View>
            {gym.description ? <Text className="mt-s1 text-2xs text-text-dim">{gym.description}</Text> : null}
            <View className="mt-s3 gap-s2">
              {(d.members ?? []).map((m) => (
                <Pressable
                  key={m.user_id}
                  onPress={() => { if (m.user_id !== myId) router.push(`/athlete/${m.user_id}` as never); }}
                  accessibilityRole="button"
                  className="flex-row items-center justify-between rounded-lg border p-s2"
                  style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text className="text-sm font-bold text-text" numberOfLines={1}>
                      {m.display_name}
                      {m.user_id === myId ? ' (you)' : ''}
                    </Text>
                    <Text className="text-2xs text-text-mute">
                      {m.role === 'owner' ? 'OWNER · ' : ''}Forge {m.forge_level ?? '—'}
                    </Text>
                  </View>
                  {m.evo_rating != null ? (
                    <Text allowFontScaling={false} style={{ fontSize: 15, color: colors.epic, ...pixelFont() }}>
                      {m.evo_rating}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </GlowCard>

          {/* Share code + battle another gym. */}
          <GlowCard glow={colors.epic}>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              INVITE · CODE {gym.join_code}
            </Text>
            <Text className="mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              BATTLE ANOTHER GYM
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              Enter a rival gym&apos;s code — the bigger total roster Evo Rating wins.
            </Text>
            <TextInput
              className="mt-s2 min-h-[46px] rounded-md border bg-surface-2 px-s3 text-center text-base font-bold text-text"
              style={{ letterSpacing: 6, borderColor: oppCode.trim().length === 6 ? `${colors.epic}8c` : colors.border }}
              placeholder="——————"
              placeholderTextColor="#64758f"
              autoCapitalize="characters"
              value={oppCode}
              onChangeText={(v) => setOppCode(v.toUpperCase())}
              maxLength={6}
              testID="gym-battle-code"
            />
            <View className="mt-s2">
              <NeonButton
                title="⚔ BATTLE"
                onPress={() => gymId && battle.mutate({ gymId, opponentCode: oppCode }, { onSuccess: () => setOppCode('') })}
                busy={battle.isPending}
                disabled={oppCode.trim().length !== 6}
                testID="gym-battle"
              />
            </View>

            {(d.battles ?? []).length > 0 ? (
              <View className="mt-s3 gap-s1">
                <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>RECENT BATTLES</Text>
                {(d.battles ?? []).slice(0, 5).map((b) => {
                  const mine = b.a_gym === gymId;
                  const myScore = mine ? b.a_score : b.b_score;
                  const theirScore = mine ? b.b_score : b.a_score;
                  const theirName = mine ? b.b_name : b.a_name;
                  const won = b.winner_gym === gymId;
                  const draw = b.winner_gym === null;
                  return (
                    <View key={b.id} className="flex-row items-center justify-between">
                      <Text className="flex-1 text-2xs text-text-dim" numberOfLines={1}>
                        vs {theirName}
                      </Text>
                      <Text
                        allowFontScaling={false}
                        style={{ fontSize: 12, color: draw ? colors['text-dim'] : won ? colors.success : colors.danger, ...pixelFont() }}
                      >
                        {myScore}–{theirScore} {draw ? 'DRAW' : won ? 'WIN' : 'LOSS'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </GlowCard>

          {/* Private group chat. */}
          <GlowCard>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              GYM CHAT
            </Text>
            <View className="mt-s2 gap-s2">
              {(messages.data ?? []).length === 0 ? (
                <Text className="py-s3 text-center text-2xs text-text-mute">No messages yet — say hello.</Text>
              ) : (
                (messages.data ?? []).map((m) => {
                  const mine = m.author_id === myId;
                  return (
                    <View
                      key={m.id}
                      className="rounded-lg border p-s2"
                      style={{
                        alignSelf: mine ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        borderColor: mine ? `${colors.accent}59` : colors.border,
                        backgroundColor: mine ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
                      }}
                    >
                      {!mine ? (
                        <Text className="text-2xs font-bold text-text-mute" numberOfLines={1}>
                          {m.author_name}
                        </Text>
                      ) : null}
                      <Text className="text-sm text-text">{m.body}</Text>
                    </View>
                  );
                })
              )}
            </View>
            <View className="mt-s3 flex-row items-center gap-s2">
              <TextInput
                className="min-h-[46px] flex-1 rounded-md border bg-surface-2 px-s3 text-base text-text"
                style={{ borderColor: msg.trim() ? `${colors.accent}8c` : colors.border }}
                placeholder="Message the gym…"
                placeholderTextColor="#64758f"
                value={msg}
                onChangeText={setMsg}
                maxLength={500}
                onSubmitEditing={send}
                returnKeyType="send"
                testID="gym-chat-input"
              />
              <Pressable
                onPress={send}
                accessibilityRole="button"
                testID="gym-chat-send"
                disabled={!msg.trim() || post.isPending}
                className="items-center justify-center rounded-md border px-s3"
                style={{ minHeight: 46, borderColor: `${colors.accent}8c`, backgroundColor: 'rgba(34,211,238,0.1)', opacity: msg.trim() ? 1 : 0.5 }}
              >
                <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>
                  SEND
                </Text>
              </Pressable>
            </View>
          </GlowCard>

          {/* Leave / disband. */}
          <Pressable
            onPress={() => gymId && leave.mutate(gymId, { onSuccess: () => router.replace('/social' as never) })}
            accessibilityRole="button"
            testID="gym-leave"
            className="items-center"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text className="text-danger" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}>
              {gym.my_role === 'owner' ? 'LEAVE (owner passes on / disbands if empty)' : 'LEAVE THIS GYM'}
            </Text>
          </Pressable>
        </>
      )}
    </ScreenShell>
  );
}
