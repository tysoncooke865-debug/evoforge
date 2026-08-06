import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Switch, Text, TextInput, View } from 'react-native';

import { useLeaderboardByMetric, usePublicIdentity, useServerGrantedXp } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { useAvatarData } from '@/data/use-avatar-data';
import { METRIC_LABEL, rankByMetric, type LeaderboardMetric } from '@/domain/leaderboard';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip } from '@/ui/core/neon-button';
import { ForgeLoader } from '@/ui/core/forge-loader';
import { LeaderboardRowView } from '@/ui/arena/leaderboard-row';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

const METRIC_ORDER: readonly LeaderboardMetric[] = ['evo', 'forge', 'consistency', 'xp'];

/**
 * The leaderboard. Ranking is BY LEVEL through the one curve, XP tiebreak,
 * then name. Viewing requires opting in yourself; an empty board shows a
 * warming-up state.
 *
 * DRIFT IS A BANNER NOW, NOT A WALL (2026-08-05 audit). An account whose XP
 * ledger and activity recount disagree used to get a full-page
 * "RANKING UNAVAILABLE" and nothing else — no board, no numbers, and a
 * closing line promising that "reconciliation restores it" when NO
 * reconciliation exists anywhere in the app or the schema. A dead end that
 * names a remedy the athlete cannot reach is worse than saying nothing.
 *
 * The integrity rule is that an unverifiable account is not LISTED, and the
 * SERVER already enforces exactly that (migration 014's rule inside
 * leaderboard_top). Hiding the board from that athlete adds no integrity —
 * it only stops them seeing where everyone else stands. So they see it, with
 * an honest banner saying they are not on it and why.
 */
export default function RankScreen() {
  const colors = useThemeColors();
  const { summary } = useAvatarData();
  const identity = usePublicIdentity();
  // MULTI-METRIC (2026-07-19): default to EVO RATING — the number the board was
  // asked to reflect — with FORGE LEVEL / CONSISTENCY / TOTAL XP tabs.
  const [metric, setMetric] = useState<LeaderboardMetric>('evo');
  const board = useLeaderboardByMetric(metric, 50);
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

  if (identity.isPending) {
    // NOT `fill`: Shell's content lives inside a ScrollView, whose content
    // sizes to its own height rather than stretching to the viewport — a
    // `flex: 1` child there has no extra space to grow into. A fixed box
    // matches what the bare spinner it replaces actually occupied.
    return (
      <Shell>
        <View className="items-center py-s8">
          <ForgeLoader label="Reading the leaderboard" />
        </View>
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

  const ranked = rankByMetric(board.data ?? []);

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
      {unexplainedDrift !== 0 ? (
        <GlowCard glow={colors.warn}>
          <Text
            className="mb-s2 text-warn"
            allowFontScaling={false}
            style={{ fontSize: 15, ...pixelFont() }}
          >
            YOU ARE NOT ON THIS BOARD
          </Text>
          <Text className="text-sm text-text-dim">
            Your XP total and your logged activity do not add up to the same number
            ({unexplainedDrift > 0 ? '+' : ''}{unexplainedDrift} XP unaccounted for), so this
            account cannot be ranked — a score nothing can cross-check is a score nobody can
            defend.
          </Text>
          <Text className="mt-s2 text-2xs text-text-mute">
            Everything else works normally, and the board below is still yours to read. Your XP
            breakdown is on the Forge Level page if you want to see where the numbers come from.
          </Text>
        </GlowCard>
      ) : null}

      {/* Metric picker: which ladder to climb. */}
      <View className="flex-row flex-wrap gap-s2">
        {METRIC_ORDER.map((m) => (
          <Chip
            key={m}
            label={METRIC_LABEL[m]}
            active={m === metric}
            onPress={() => setMetric(m)}
            testID={`rank-metric-${m}`}
          />
        ))}
      </View>

      <GlowCard>
        <Text
          className="mb-s4 text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          TOP ATHLETES · BY {METRIC_LABEL[metric]}
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
              metric={metric}
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
        accessibilityRole="button"
        accessibilityLabel={save.isPending ? 'Saving your public identity' : 'Save your public identity'}
        accessibilityState={{ disabled: save.isPending, busy: save.isPending }}
        style={{ minHeight: 44, justifyContent: 'center' }}
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
