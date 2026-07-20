import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import {
  shareGymInvite,
  useDiscoverGyms,
  useGymBattle,
  useGymDetail,
  useGymMessages,
  useJoinGym,
  useLeaveGym,
  usePostGymMessage,
  useSetGymPublic,
  type GymBattleOutcome,
} from '@/data/gyms';
import { useBlockedSet, useReportContent } from '@/data/moderation';
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
  // `invite` is the gym share token (076) — lets you join a PRIVATE gym via its
  // shared link.
  const { id, invite: inviteToken } = useLocalSearchParams<{ id: string; invite?: string }>();
  const gymId = typeof id === 'string' ? id : null;
  const joinToken = typeof inviteToken === 'string' ? inviteToken : null;
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;

  const detail = useGymDetail(gymId);
  const messages = useGymMessages(gymId);
  const post = usePostGymMessage();
  const battle = useGymBattle();
  const leave = useLeaveGym();
  const join = useJoinGym();
  const setPublic = useSetGymPublic();
  const report = useReportContent();
  const blocked = useBlockedSet();

  const [msg, setMsg] = useState('');
  const [oppSearch, setOppSearch] = useState('');
  const [oppDebounced, setOppDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setOppDebounced(oppSearch), 200);
    return () => clearTimeout(t);
  }, [oppSearch]);
  const oppResults = useDiscoverGyms(oppDebounced);
  const [result, setResult] = useState<GymBattleOutcome | null>(null);

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
          <Text className="py-s3 text-center text-sm text-text-dim">
            Join this gym to see the roster, chat and battles.
          </Text>
          {gymId ? (
            <NeonButton
              title={join.isPending ? 'JOINING…' : '+ JOIN THIS GYM'}
              onPress={() => join.mutate({ gymId, token: joinToken }, { onSuccess: () => detail.refetch() })}
              busy={join.isPending}
              testID="gym-join-link"
            />
          ) : null}
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

          {/* Invite (share link) + owner visibility toggle + battle another gym. */}
          <GlowCard glow={colors.epic}>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>INVITE</Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              {gym.is_public ? 'Public — anyone can find and join this gym.' : 'Private — only people with your link can join.'} Share your link to recruit directly.
            </Text>
            <View className="mt-s2">
              <NeonButton title="SHARE GYM LINK" variant="ghost" onPress={() => gymId && void shareGymInvite(gymId)} testID="gym-share" />
            </View>
            {gym.my_role === 'owner' && gymId ? (
              <Pressable
                onPress={() => setPublic.mutate({ gymId, isPublic: !gym.is_public })}
                accessibilityRole="button"
                testID="gym-toggle-public"
                className="mt-s2 flex-row items-center justify-between rounded-md border p-s2"
                style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
              >
                <Text className="text-2xs text-text-dim">{gym.is_public ? 'Listed in gym discovery' : 'Hidden — link-only'}</Text>
                <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, color: gym.is_public ? colors.success : colors['text-mute'], ...pixelFont(false) }}>
                  {gym.is_public ? 'PUBLIC ✓' : 'PRIVATE'}
                </Text>
              </Pressable>
            ) : null}

            <Text className="mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              BATTLE ANOTHER GYM
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              Find a rival gym — your rosters fight member-vs-member in the combat engine; most duels won takes it.
            </Text>
            <TextInput
              className="mt-s2 min-h-[46px] rounded-md border bg-surface-2 px-s3 text-base text-text"
              style={{ borderColor: oppSearch.trim() ? `${colors.epic}8c` : colors.border }}
              placeholder="Search a rival gym…"
              placeholderTextColor="#64758f"
              autoCapitalize="none"
              autoCorrect={false}
              value={oppSearch}
              onChangeText={setOppSearch}
              maxLength={30}
              testID="gym-battle-search"
            />
            {oppSearch.trim() ? (
              <View className="mt-s2 gap-s2">
                {(oppResults.data ?? []).filter((o) => o.gym_id !== gymId).length === 0 ? (
                  <Text className="text-2xs text-text-mute">No public gyms match.</Text>
                ) : (
                  (oppResults.data ?? [])
                    .filter((o) => o.gym_id !== gymId)
                    .slice(0, 6)
                    .map((o) => (
                      <Pressable
                        key={o.gym_id}
                        onPress={() =>
                          gymId &&
                          battle.mutate(
                            { gymId, opponentGym: o.gym_id },
                            { onSuccess: (r) => { setOppSearch(''); setResult(r); } }
                          )
                        }
                        disabled={battle.isPending}
                        accessibilityRole="button"
                        testID={`gym-battle-${o.gym_id}`}
                        className="flex-row items-center justify-between rounded-lg border p-s2"
                        style={{ borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text className="text-sm font-bold text-text" numberOfLines={1}>{o.name}</Text>
                          <Text className="text-2xs text-text-mute">{o.member_count} · ⚡ {o.roster_power}</Text>
                        </View>
                        <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>{battle.isPending ? '…' : '⚔'}</Text>
                      </Pressable>
                    ))
                )}
              </View>
            ) : null}

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
                (messages.data ?? [])
                  .filter((m) => !blocked.has(m.author_id)) // hide blocked members' messages
                  .map((m) => {
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
                        <View className="flex-row items-center justify-between gap-s2">
                          <Text className="text-2xs font-bold text-text-mute" numberOfLines={1}>
                            {m.author_name}
                          </Text>
                          <Pressable
                            onPress={() => report.mutate({ type: 'gym_message', id: m.id, reason: 'inappropriate' })}
                            accessibilityRole="button"
                            accessibilityLabel="report message"
                            testID={`gym-msg-report-${m.id}`}
                            hitSlop={8}
                          >
                            <Text style={{ fontSize: 11, color: colors.warn }}>⚑</Text>
                          </Pressable>
                        </View>
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

      {result ? <GymBattleResultModal result={result} onClose={() => setResult(null)} /> : null}
    </ScreenShell>
  );
}

/** The engine battle's outcome: overall verdict + the per-member duel card
 *  (champion combat, not a stat sum). */
function GymBattleResultModal({ result, onClose }: { result: GymBattleOutcome; onClose: () => void }) {
  const colors = useThemeColors();
  const tint = result.result === 'win' ? colors.success : result.result === 'loss' ? colors.danger : colors['text-dim'];
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center px-s4" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable onPress={() => undefined} className="w-full max-w-[440px] rounded-xl border p-s4" style={{ borderColor: `${tint}66`, backgroundColor: colors.surface }}>
          <Text className="text-center" allowFontScaling={false} style={{ fontSize: 22, color: tint, letterSpacing: 1, ...pixelFont() }}>
            {result.result === 'win' ? 'VICTORY' : result.result === 'loss' ? 'DEFEAT' : 'DRAW'}
          </Text>
          <Text className="mt-s1 text-center text-2xs text-text-mute" numberOfLines={1}>
            {result.my_name} {result.a_score} — {result.b_score} {result.opponent_name}
          </Text>
          <View className="mt-s3 gap-s1">
            {result.duels.map((d, i) => (
              <View key={i} className="flex-row items-center justify-between rounded-md border border-border px-s2" style={{ minHeight: 34, backgroundColor: 'rgba(13,21,36,0.5)' }}>
                <Text className={`flex-1 text-2xs ${d.winner === 'a' ? 'text-success' : 'text-text-mute'}`} numberOfLines={1}>
                  {d.winner === 'a' ? '▶ ' : ''}{d.a_name} ({d.a_hp_pct}%)
                </Text>
                <Text className="text-2xs text-text-mute px-s2">vs</Text>
                <Text className={`flex-1 text-right text-2xs ${d.winner === 'b' ? 'text-danger' : 'text-text-mute'}`} numberOfLines={1}>
                  {d.b_name} ({d.b_hp_pct}%){d.winner === 'b' ? ' ◀' : ''}
                </Text>
              </View>
            ))}
          </View>
          <View className="mt-s3">
            <NeonButton title="DONE" onPress={onClose} testID="gym-battle-done" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
