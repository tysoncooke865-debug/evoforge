import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useFriendCode, useFriends, useFriendRequests, useRespondRequest, useSendFriendRequest } from '@/data/social';
import { useRecommendedAthletes, useSearchAthletes } from '@/data/social-profile';
import { pixelFont } from '@/theme/fonts';
import { AddFriendButton } from '@/ui/social/add-friend-button';
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
  const [search, setSearch] = useState('');
  // Typeahead: 150ms after the last keystroke drives the query (below "laggy",
  // above the character rate) — suggestions pop up as you type, unthrottled
  // keystrokes no longer fire one RPC each.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);
  const hits = useSearchAthletes(debounced);
  const searching = search.trim().length >= 2;
  const recommended = useRecommendedAthletes();
  // §7.1: this screen is reachable from Arena AND Social; router.back() pops
  // the TAB history (→ Home), so the pusher says where back goes. Default is
  // Social — every un-tagged door here is social's.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const backTarget = from === 'arena' ? '/arena' : '/social';

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={from === 'arena' ? 'ARENA' : 'SOCIAL'}
        title="FRIENDS & RIVALS"
        onBack={() => router.replace(backTarget as never)}
      />

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

      {/* §6.3 (060): add by USERNAME — the searchable half of add-a-friend.
          Only public+discoverable athletes surface (the request_friend gate),
          so a hit is always addable. */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 1.5, ...pixelFont(false) }}>
          ADD BY USERNAME
        </Text>
        <TextInput
          className="mt-s2 min-h-[48px] rounded-md border bg-surface-2 px-s3 text-base text-text"
          style={{ borderColor: search.trim().length >= 2 ? `${colors.epic}8c` : colors.border }}
          placeholder="Search usernames…"
          placeholderTextColor="#64758f"
          autoCapitalize="none"
          value={search}
          onChangeText={setSearch}
          maxLength={24}
          testID="friend-search-input"
        />
        {searching ? (
          hits.isPending ? (
            <Text className="mt-s2 text-2xs text-text-mute">Searching…</Text>
          ) : (hits.data ?? []).length === 0 ? (
            <Text className="mt-s2 text-2xs text-text-mute" testID="friend-search-empty">
              No discoverable athletes match — private athletes are added by code.
            </Text>
          ) : (
            <View className="mt-s2 gap-s2">
              {(hits.data ?? []).map((a) => (
                <AthleteHit
                  key={a.user_id}
                  id={a.user_id}
                  name={a.display_name}
                  forge={a.forge_level}
                  isFriend={a.is_friend}
                  testID={`friend-hit-${a.user_id}`}
                />
              ))}
            </View>
          )
        ) : null}
      </GlowCard>

      {/* SUGGESTED FRIENDS (067) — discoverable athletes ranked by shared
          friends. Hidden while a search is active. */}
      {!searching && (recommended.data ?? []).length > 0 ? (
        <GlowCard>
          <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, letterSpacing: 1.5, ...pixelFont(false) }}>
            SUGGESTED FRIENDS
          </Text>
          <View className="mt-s2 gap-s2">
            {(recommended.data ?? []).map((a) => (
              <AthleteHit
                key={a.user_id}
                id={a.user_id}
                name={a.display_name}
                forge={a.forge_level}
                mutual={a.mutual_count}
                testID={`friend-suggested-${a.user_id}`}
              />
            ))}
          </View>
        </GlowCard>
      ) : null}

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

/** One found/suggested athlete: tap the row to open their profile; the ADD
 *  button (or a mutual-friend hint) sits on the right. */
function AthleteHit({
  id,
  name,
  forge,
  isFriend,
  mutual,
  testID,
}: {
  id: string;
  name: string;
  forge: number | null;
  isFriend?: boolean;
  mutual?: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push(`/athlete/${id}` as never)}
      accessibilityRole="button"
      testID={testID}
      className="flex-row items-center justify-between rounded-xl border p-s3"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-sm font-bold text-text" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {forge != null ? `LV. ${forge}` : 'Athlete'}
          {mutual && mutual > 0 ? ` · ${mutual} mutual friend${mutual === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      {isFriend ? (
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
          ✓ FRIENDS
        </Text>
      ) : (
        <AddFriendButton athleteId={id} testID={`friend-add-${id}`} />
      )}
    </Pressable>
  );
}
