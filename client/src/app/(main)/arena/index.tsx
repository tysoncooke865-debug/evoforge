import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useMyBattles, type BattleMatch } from '@/data/battle/hooks';
import { useBattleSnapshot, useCreateInvite, useJoinBattle } from '@/data/battle/mutations';
import tokens from '@/theme/tokens';
import { EdgeLabel } from '@/ui/hud';
import { NeonButton } from '@/ui/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * The Arena hub: friendly BLITZ battles are live; Quick Match / Ranked are
 * honest placeholders until the queue ships (P3/P4). History rides RLS —
 * the list is exactly the matches this athlete fought.
 */
export default function ArenaScreen() {
  const router = useRouter();
  const snapshot = useBattleSnapshot();
  const invite = useCreateInvite();
  const join = useJoinBattle();
  const battles = useMyBattles();
  const [code, setCode] = useState('');

  const createBattle = () => {
    invite.mutate(snapshot, {
      onSuccess: (data) => router.push(`/arena/battle/${String(data.match_id)}`),
    });
  };

  const joinBattle = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6) return;
    join.mutate(
      { code: clean, snapshot },
      {
        onSuccess: (data) => {
          setCode('');
          router.push(`/arena/battle/${String(data.match_id)}`);
        },
      }
    );
  };

  return (
    <ScreenShell>
      <ScreenHeader kicker="SEASON 0 · PREVIEW" title="BATTLE ARENA" />

      {/* Friendly battle — the live mode. */}
      <GlowCard glow={tokens.colors.accent}>
        <View className="mb-s1">
          <EdgeLabel
            right={
              <Text className="text-2xs font-bold" style={{ color: tokens.colors.rare, letterSpacing: 1.5 }}>
                BLITZ · ~25 MIN
              </Text>
            }
          >
            FRIENDLY BATTLE
          </EdgeLabel>
        </View>
        <Text className="mb-s4 text-2xs text-text-mute">
          Three lifts a rut, twelve minutes a bell. Challenge a friend, lift the object first.
        </Text>
        <NeonButton
          title="CREATE BATTLE · GET CODE"
          onPress={createBattle}
          busy={invite.isPending}
          testID="arena-create"
        />
        <View className="mt-s3 flex-row items-center gap-s2">
          <TextInput
            className="min-h-[44px] flex-1 rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
            style={{ letterSpacing: 6, fontWeight: '800' }}
            placeholder="CODE"
            placeholderTextColor="#64758f"
            autoCapitalize="characters"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            testID="arena-code"
          />
          <Pressable
            onPress={joinBattle}
            disabled={join.isPending || code.trim().length !== 6}
            accessibilityRole="button"
            className={`min-h-[44px] items-center justify-center rounded-md px-s4 ${code.trim().length === 6 ? 'bg-accent' : 'border border-border bg-surface-2'}`}
            style={
              code.trim().length === 6
                ? { shadowColor: tokens.colors.accent, shadowOpacity: 0.45, shadowRadius: 10, elevation: 5 }
                : undefined
            }
            testID="arena-join"
          >
            <Text className={`text-xs font-bold ${code.trim().length === 6 ? 'text-accent-ink' : 'text-text-mute'}`} style={{ letterSpacing: 1 }}>
              JOIN
            </Text>
          </Pressable>
        </View>
      </GlowCard>

      {/* The queue modes — coming, honestly labelled. */}
      <View className="flex-row gap-s3">
        <ComingCard title="QUICK MATCH" note="Matchmaking queue" />
        <ComingCard title="RANKED" note="Trophies on the line" />
      </View>

      <View>
        <SectionLabel>BATTLE HISTORY</SectionLabel>
        {(battles.data ?? []).length === 0 ? (
          <Text className="text-2xs text-text-mute">No battles yet. Mint a code and call someone out.</Text>
        ) : (
          (battles.data ?? []).map((m) => <HistoryRow key={m.id} match={m} />)
        )}
      </View>
    </ScreenShell>
  );
}

function ComingCard({ title, note }: { title: string; note: string }) {
  return (
    <View
      className="flex-1 rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <Text className="text-xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
        {title}
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute">{note}</Text>
      <Text className="mt-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
        SOON
      </Text>
    </View>
  );
}

function HistoryRow({ match }: { match: BattleMatch }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const settled = match.status === 'settled';
  const won = settled && match.winner_user_id !== null && match.winner_user_id === userId;
  const draw = settled && match.winner_user_id === null;
  const tint = !settled
    ? tokens.colors.accent
    : won
      ? tokens.colors.success
      : draw
        ? tokens.colors.rare
        : tokens.colors.danger;
  const label = !settled ? match.status.toUpperCase() : won ? 'VICTORY' : draw ? 'DRAW' : 'DEFEAT';

  return (
    <Pressable
      onPress={() => router.push(`/arena/battle/${match.id}`)}
      accessibilityRole="button"
      className="mb-s2 flex-row items-center rounded-xl p-s3"
      style={{ borderWidth: 1, borderColor: `${tint}40`, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <View className="flex-1">
        <Text className="text-sm font-bold text-text">
          Friendly Blitz{match.invite_code ? ` · ${match.invite_code}` : ''}
        </Text>
        <Text className="text-2xs text-text-mute">{String(match.created_at).slice(0, 10)}</Text>
      </View>
      <Text className="text-xs font-bold" style={{ color: tint, letterSpacing: 1.5 }}>
        {label}
      </Text>
    </Pressable>
  );
}
