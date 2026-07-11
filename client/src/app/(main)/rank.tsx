import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { useLeaderboardTop, usePublicIdentity } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLeaderboard } from '@/domain/leaderboard';
import tokens from '@/theme/tokens';

/**
 * The leaderboard. Three gates before any ranking renders, same as the
 * Streamlit page: (1) an account with non-zero xp_drift is refused -- a
 * number nothing cross-checks is a number nobody can defend; (2) viewing
 * requires opting in yourself; (3) an empty board shows a warming-up state.
 * Ranking is BY LEVEL through the one curve, XP tiebreak, then name.
 */
export default function RankScreen() {
  const { summary } = useAvatarData();
  const identity = usePublicIdentity();
  const board = useLeaderboardTop(50);

  if (summary.xpDrift !== 0) {
    return (
      <Shell>
        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s2 text-lg font-bold text-warn">RANKING UNAVAILABLE</Text>
          <Text className="text-sm text-text-dim">
            Your XP ledger and activity recount disagree (drift {summary.xpDrift}). The board
            refuses unreconciled accounts — reconciliation restores it.
          </Text>
        </View>
      </Shell>
    );
  }

  if (identity.isPending) {
    return (
      <Shell>
        <ActivityIndicator color={tokens.colors.accent} />
      </Shell>
    );
  }

  if (!identity.data?.displayName || !identity.data.isPublic) {
    return (
      <Shell>
        <OptInCard current={identity.data?.displayName ?? null} />
      </Shell>
    );
  }

  const ranked = rankLeaderboard(board.data ?? []);

  return (
    <Shell>
      <View className="rounded-lg border border-border bg-surface p-s6">
        <Text className="mb-s4 text-xs text-text-mute">TOP ATHLETES · BY LEVEL</Text>
        {ranked.length === 0 ? (
          <Text className="text-sm text-text-dim">
            The leaderboard is warming up — no ranked athletes yet.
          </Text>
        ) : (
          ranked.map((e) => (
            <View
              key={`${e.position}-${e.displayName}`}
              className={`mb-s2 flex-row items-center rounded-md border p-s3 ${
                e.displayName === identity.data?.displayName
                  ? 'border-border-strong bg-surface-3'
                  : 'border-border bg-surface-2'
              }`}
            >
              <Text className="w-s10 text-sm font-bold text-accent">
                {({ 1: '🥇', 2: '🥈', 3: '🥉' } as Record<number, string>)[e.position] ?? `#${e.position}`}
              </Text>
              <Text className="flex-1 font-bold text-text" numberOfLines={1}>
                {e.displayName}
              </Text>
              <Text className="mr-s3 text-xs text-text-mute">{e.rank}</Text>
              <Text className="mr-s3 text-sm font-bold text-text">Lv {e.level}</Text>
              <Text className="text-xs text-text-dim">{e.xp} XP</Text>
            </View>
          ))
        )}
      </View>
    </Shell>
  );
}

function OptInCard({ current }: { current: string | null }) {
  const [name, setName] = useState(current ?? '');
  const [isPublic, setIsPublic] = useState(true);
  const save = useSavePublicIdentity();

  return (
    <View className="rounded-lg border border-border bg-surface p-s6">
      <Text className="mb-s2 text-lg font-bold text-accent">JOIN THE BOARD</Text>
      <Text className="mb-s4 text-sm text-text-dim">
        The leaderboard shows only a display name, level and XP — never body data. Opt in to see
        and be seen.
      </Text>
      <Text className="mb-s1 text-xs text-text-mute">DISPLAY NAME (3–24 CHARS)</Text>
      <TextInput
        className="mb-s3 rounded-md border border-border bg-surface-2 p-s3 text-text"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        testID="display-name"
      />
      <View className="mb-s4 flex-row items-center justify-between">
        <Text className="text-sm text-text-dim">Visible on the leaderboard</Text>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ true: tokens.colors['accent-deep'], false: tokens.colors['surface-3'] }}
          thumbColor={tokens.colors.accent}
        />
      </View>
      <Pressable
        className="items-center rounded-md bg-accent p-s3"
        onPress={() => save.mutate({ displayName: name, isPublic })}
        disabled={save.isPending}
        testID="save-identity"
      >
        {save.isPending ? (
          <ActivityIndicator color="#04121a" />
        ) : (
          <Text className="font-bold text-accent-ink">SAVE & JOIN</Text>
        )}
      </Pressable>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px]">{children}</View>
    </ScrollView>
  );
}
