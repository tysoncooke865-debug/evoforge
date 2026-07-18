import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Switch, Text, TextInput, View } from 'react-native';

import { useLeaderboardTop, usePublicIdentity, useServerGrantedXp } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLeaderboard } from '@/domain/leaderboard';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { LeaderboardRowView } from '@/ui/arena/leaderboard-row';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * The leaderboard. Three gates before any ranking renders, same as the
 * Streamlit page: (1) an account with non-zero xp_drift is refused -- a
 * number nothing cross-checks is a number nobody can defend; (2) viewing
 * requires opting in yourself; (3) an empty board shows a warming-up state.
 * Ranking is BY LEVEL through the one curve, XP tiebreak, then name.
 */
export default function RankScreen() {
  const colors = useThemeColors();
  const { summary } = useAvatarData();
  const identity = usePublicIdentity();
  const board = useLeaderboardTop(50);
  const serverGranted = useServerGrantedXp();

  // Migration 014's rule, applied to the CLIENT gate too: drift is only a
  // problem when it isn't explained by server-granted XP (battles,
  // adjustments) — those are legitimate ledger-over-derived surplus, and
  // the server-side board admits them. Refusing here while the SQL admits
  // was the bug Tyson hit ("drift 400" = his battle XP).
  const unexplainedDrift =
    serverGranted.data === null || serverGranted.data === undefined
      ? summary.xpDrift // breakdown unavailable: fall back to the strict rule
      : summary.xpDrift - serverGranted.data;

  if (unexplainedDrift !== 0) {
    return (
      <Shell>
        <GlowCard glow={colors.warn}>
          <Text
            className="mb-s2 text-warn"
            allowFontScaling={false}
            style={{ fontSize: 18, ...pixelFont() }}
          >
            RANKING UNAVAILABLE
          </Text>
          <Text className="text-sm text-text-dim">
            Your XP ledger and activity recount disagree (drift {unexplainedDrift} beyond
            server-granted XP). The board refuses unreconciled accounts — reconciliation
            restores it.
          </Text>
        </GlowCard>
      </Shell>
    );
  }

  if (identity.isPending) {
    return (
      <Shell>
        <ActivityIndicator color={colors.accent} />
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
    <Shell
      refreshControl={
        // Freshness (2026-07-19): the query already polls at 60s while
        // focused; the pull is the athlete's "now" button.
        <RefreshControl
          refreshing={board.isRefetching}
          onRefresh={() => void board.refetch()}
          tintColor={colors.accent}
        />
      }
    >
      <GlowCard>
        <Text
          className="mb-s4 text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          TOP ATHLETES · BY LEVEL
        </Text>
        {ranked.length === 0 ? (
          <Text className="text-sm text-text-dim">
            The leaderboard is warming up — no ranked athletes yet.
          </Text>
        ) : (
          ranked.map((e) => (
            <LeaderboardRowView
              key={`${e.position}-${e.displayName}`}
              entry={e}
              self={e.displayName === identity.data?.displayName}
            />
          ))
        )}
      </GlowCard>
    </Shell>
  );
}

function OptInCard({ current }: { current: string | null }) {
  const colors = useThemeColors();
  const [name, setName] = useState(current ?? '');
  const [isPublic, setIsPublic] = useState(true);
  const save = useSavePublicIdentity();

  return (
    <GlowCard glow={colors.accent}>
      <Text className="mb-s2 text-accent" allowFontScaling={false} style={{ fontSize: 18, ...pixelFont() }}>
        JOIN THE BOARD
      </Text>
      <Text className="mb-s4 text-sm text-text-dim">
        The leaderboard shows only a display name, level and XP — never body data. Opt in to see
        and be seen.
      </Text>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        DISPLAY NAME (3–24 CHARS)
      </Text>
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
          trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
          thumbColor={colors.accent}
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
          <Text className="text-accent-ink" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            SAVE & JOIN
          </Text>
        )}
      </Pressable>
    </GlowCard>
  );
}

function Shell({
  children,
  refreshControl,
}: {
  children: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScreenShell>['refreshControl'];
}) {
  return (
    <ScreenShell refreshControl={refreshControl}>
      <ScreenHeader kicker="OPT IN TO COMPETE" title="RANK" />
      {children}
    </ScreenShell>
  );
}
