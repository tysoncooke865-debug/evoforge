import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useCoinTotal } from '@/data/coins';
import {
  useDuelConfig,
  useDuelTimeline,
  useDuelWatch,
  useReactToDuel,
  useSupportDuel,
} from '@/data/forge-duel';
import { CHALLENGE_INFO, type ChallengeType } from '@/domain/forge-challenge';
import {
  DEFAULT_DUEL_CONFIG,
  clampStake,
  countdown,
  estimateSupportReturn,
  formatCoins,
  supportSplit,
  unitLabel,
  type DuelReactionKey,
} from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { CoinBalance, DuelCountdown, useNow } from '@/ui/duel/duel-hud';
import { DuelCardLabel, DuelTimeline } from '@/ui/duel/duel-timeline';
import { ForgePot } from '@/ui/duel/forge-pot';
import { DuelReactions, MySupport, SupporterMeter } from '@/ui/duel/supporter-meter';

/**
 * WATCHING A FRIEND'S DUEL.
 *
 * WHAT A SPECTATOR SEES AND WHAT THEY DO NOT. They see the two names, the duel
 * metric, the scoreline, the pot, the clock and the crowd — everything the two
 * athletes agreed to put on a table. They do not see baselines, escrow splits,
 * measurements, photos or a single workout row, and the server enforces that
 * (forge_duel_watch returns a fixed shape; forge_duel_timeline whitelists the
 * keys it will emit). The participants can also switch spectating off entirely
 * when they create the duel.
 *
 * BACKING A SIDE IS A PREDICTION WITH REAL STAKES AND NO INVENTED ODDS. The
 * pool is PARI-MUTUEL: the winning side's backers divide the losing side's
 * coins in proportion to what they put in. There is no house float and no
 * multiplier, which is the only construction where the pool provably cannot pay
 * out more than it took in.
 */
export default function WatchDuelScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const colors = useThemeColors();
  const { session } = useAuth();
  const myId = session?.user?.id ?? '';
  const nowMs = useNow();
  const watch = useDuelWatch(id);
  const timeline = useDuelTimeline(id);
  const coins = useCoinTotal();
  const support = useSupportDuel();
  const react = useReactToDuel();
  const cfgQuery = useDuelConfig();
  const cfg = cfgQuery.data ?? DEFAULT_DUEL_CONFIG;

  const [backing, setBacking] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);

  if (watch.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="SPECTATING" title="DUEL" onBack={() => router.back()} />
        <SkeletonScreen cards={3} testID="watch-loading" />
      </ScreenShell>
    );
  }

  if (watch.isError || !watch.data) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="SPECTATING" title="DUEL" onBack={() => router.back()} />
        <GlowCard testID="watch-closed">
          <Text className="text-sm text-text">This duel is not open to you.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            You can watch a duel when you are friends with one of the athletes and they left
            spectating on.
          </Text>
          <View className="mt-s3">
            <NeonButton title="BACK TO DUELS" variant="ghost" pixel onPress={() => router.replace('/challenges' as never)} testID="watch-back" />
          </View>
        </GlowCard>
      </ScreenShell>
    );
  }

  const d = watch.data;
  const info = CHALLENGE_INFO[d.challenge_type as ChallengeType];
  const balance = coins.data ?? 0;
  const settled = d.status === 'settled';
  const supportOpen =
    d.status === 'active' && d.support_closes_at !== null && Date.parse(d.support_closes_at) > nowMs;
  const canBack = supportOpen && !d.i_am_participant && d.my_support === null;
  const maxBack = Math.max(0, Math.min(balance, cfg.max_support));

  const scoreOf = (side: 'challenger' | 'opponent'): number => {
    const cur = side === 'challenger' ? d.challenger_current : d.opponent_current;
    const base = side === 'challenger' ? d.challenger_baseline : d.opponent_baseline;
    if (d.challenge_type !== 'most_improved_lift') return cur?.value ?? 0;
    if (base === null || base <= 0 || !cur) return 0;
    return Math.round(((cur.value - base) / base) * 100 * 10) / 10;
  };
  const label = (v: number) =>
    d.challenge_type === 'most_improved_lift' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : unitLabel(v, info.unit);
  const a = scoreOf('challenger');
  const b = scoreOf('opponent');
  const leaderName =
    d.leader_id === d.challenger_id ? d.challenger_name
      : d.leader_id === d.opponent_id ? d.opponent_name
        : null;

  const split = supportSplit(d.support_challenger, d.support_opponent);
  const myPool = d.my_support
    ? d.my_support.backed_id === d.challenger_id ? d.support_challenger : d.support_opponent
    : 0;
  const otherPool = d.my_support
    ? d.my_support.backed_id === d.challenger_id ? d.support_opponent : d.support_challenger
    : 0;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={settled ? 'SETTLED' : 'SPECTATING'}
        title="THE DUEL"
        onBack={() => router.back()}
        right={
          settled ? (
            <CoinBalance coins={coins.data ?? null} size="sm" testID="watch-balance" />
          ) : (
            <DuelCountdown endsAt={d.ends_at} nowMs={nowMs} testID="watch-countdown" />
          )
        }
      />

      <GlowCard testID="watch-scoreline">
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.4 }}>{info.name}</Text>
        <View className="mt-s3 flex-row items-center" style={{ gap: 10 }}>
          <Contender
            name={d.challenger_name}
            score={label(a)}
            lead={d.leader_id === d.challenger_id}
            settled={settled}
            tint={colors.accent}
            testID="watch-challenger"
          />
          <Text
            allowFontScaling={false}
            style={{ fontSize: 13, color: colors['text-mute'], letterSpacing: 1, ...pixelFont() }}
          >
            VS
          </Text>
          <Contender
            name={d.opponent_name}
            score={label(b)}
            lead={d.leader_id === d.opponent_id}
            settled={settled}
            tint={colors.danger}
            right
            testID="watch-opponent"
          />
        </View>
        <Text className="mt-s3 text-center text-2xs text-text-mute">
          {settled
            ? d.outcome === 'draw'
              ? 'A draw — both stakes refunded.'
              : `${d.winner_id === d.challenger_id ? d.challenger_name : d.opponent_name} took the pot.`
            : leaderName
              ? `${leaderName} is ahead. ${countdown(Date.parse(d.ends_at ?? '') - nowMs)} left.`
              : 'Nothing between them.'}
        </Text>
      </GlowCard>

      <ForgePot
        pot={d.pot}
        perAthlete={Math.round(d.pot / 2)}
        label={settled ? 'FINAL POT' : 'CURRENT POT'}
        note="Between the two of them"
        testID="watch-pot"
      />

      {/* ── THE CROWD ── */}
      <GlowCard testID="watch-crowd">
        <DuelCardLabel>THE CROWD</DuelCardLabel>
        <View className="mt-s3">
          <SupporterMeter
            challengerName={d.challenger_name}
            opponentName={d.opponent_name}
            challengerTotal={d.support_challenger}
            opponentTotal={d.support_opponent}
            supporterCount={d.supporter_count}
            closesAt={d.support_closes_at}
            nowMs={nowMs}
            live={d.status === 'active'}
            testID="watch-support-meter"
          />
        </View>

        {d.my_support ? (
          <View className="mt-s3">
            <MySupport
              backedName={d.my_support.backed_id === d.challenger_id ? d.challenger_name : d.opponent_name}
              amount={d.my_support.amount}
              payout={d.my_support.payout}
              estimate={estimateSupportReturn(d.my_support.amount, myPool, otherPool, cfg.support_rake_bp)}
              settled={d.my_support.settled_at !== null}
              testID="watch-my-support"
            />
          </View>
        ) : null}

        {canBack ? (
          backing === null ? (
            <View className="mt-s3 flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <NeonButton
                  title={`BACK ${shortName(d.challenger_name)}`}
                  variant="ghost"
                  pixel
                  disabled={maxBack < 1}
                  onPress={() => { setBacking(d.challenger_id); setAmount(Math.min(25, maxBack)); }}
                  testID="watch-back-challenger"
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  title={`BACK ${shortName(d.opponent_name)}`}
                  variant="ghost"
                  pixel
                  disabled={maxBack < 1}
                  onPress={() => { setBacking(d.opponent_id); setAmount(Math.min(25, maxBack)); }}
                  testID="watch-back-opponent"
                />
              </View>
            </View>
          ) : (
            <View className="mt-s3">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 13, color: colors.accent, letterSpacing: 1, ...pixelFont() }}
              >
                BACKING {(backing === d.challenger_id ? d.challenger_name : d.opponent_name).toUpperCase()}
              </Text>
              <View className="mt-s3">
                <ChipWagerTable
                  value={amount}
                  onChange={(v) => setAmount(clampStake(v, balance, { ...cfg, max_stake: cfg.max_support }))}
                  balance={balance}
                  min={1}
                  max={maxBack}
                  potLabel="YOUR SUPPORT"
                  potOf={(v) => v}
                  testID="watch-support-table"
                />
              </View>
              <Text className="mt-s2 text-2xs text-text-mute">
                {(() => {
                  const pool = backing === d.challenger_id ? d.support_challenger : d.support_opponent;
                  const other = backing === d.challenger_id ? d.support_opponent : d.support_challenger;
                  const est = estimateSupportReturn(amount, pool + amount, other, cfg.support_rake_bp);
                  return other > 0
                    ? `If they win you would take about ${formatCoins(est)} back — your stake plus a share of the ${formatCoins(other)} on the other side. The estimate moves as more people back a side.`
                    : 'Nobody is backing the other side yet, so there is nothing to win. If that stays true you simply get your coins back.';
                })()}
              </Text>
              <View className="mt-s3">
                <NeonButton
                  title={support.isPending ? 'PLACING…' : `CONFIRM · ${formatCoins(amount)} COINS`}
                  pixel
                  disabled={amount < 1 || support.isPending}
                  busy={support.isPending}
                  onPress={() =>
                    support.mutate(
                      { challengeId: d.id, backedId: backing, amount },
                      { onSuccess: () => setBacking(null) }
                    )
                  }
                  testID="watch-support-confirm"
                />
              </View>
              <NeonButton title="CANCEL" variant="ghost" pixel onPress={() => setBacking(null)} testID="watch-support-cancel" />
            </View>
          )
        ) : (
          <Text className="mt-s3 text-2xs text-text-mute" testID="watch-support-note">
            {d.i_am_participant
              ? 'You are in this duel — raise the stakes instead of backing it.'
              : d.my_support
                ? 'One position per duel. Yours is locked in.'
                : settled
                  ? 'This duel has settled.'
                  : 'Support has closed for this duel.'}
          </Text>
        )}

        <Text className="mt-s3 text-2xs text-text-mute">
          Backers share the losing side&apos;s pool in proportion to their own stake. No odds, no
          house cut{cfg.support_rake_bp > 0 ? ` beyond ${(cfg.support_rake_bp / 100).toFixed(1)}%` : ''}, and
          nothing is minted —{' '}
          {split.total === 0
            ? 'the pool is empty'
            : settled
              ? `${formatCoins(split.total)} was in the pool`
              : `${formatCoins(split.total)} is in the pool`}.
        </Text>
      </GlowCard>

      {/* ── REACTIONS ── */}
      <GlowCard testID="watch-reactions">
        <DuelCardLabel>REACT</DuelCardLabel>
        <View className="mt-s3">
          <DuelReactions
            counts={d.reactions ?? {}}
            mine={d.my_reactions ?? []}
            onToggle={(emoji: DuelReactionKey, on) => react.mutate({ challengeId: d.id, emoji, on })}
            testID="watch-reaction-row"
          />
        </View>
      </GlowCard>

      {/* ── THE LOG ── */}
      <SectionLabel>DUEL LOG</SectionLabel>
      <GlowCard testID="watch-timeline-card">
        <DuelTimeline
          events={timeline.data ?? []}
          myId={myId}
          myName="You"
          loading={timeline.isPending}
          testID="watch-timeline"
        />
      </GlowCard>

      <Text className="text-2xs text-text-mute">
        You can see the contest and the scoreline only. Measurements, photos and workout logs are
        never shared with spectators.
      </Text>
    </ScreenShell>
  );
}

/**
 * A name that fits inside a button, cut on a word boundary where there is one.
 *
 * A hard slice produced "BACK SMOKE-ALPH", which reads as a rendering bug
 * rather than a long name. Two buttons side by side on a 390pt screen have
 * about twelve characters each after the verb; a display name is capped at 24.
 */
function shortName(name: string): string {
  const upper = name.toUpperCase();
  if (upper.length <= 12) return upper;
  const cut = upper.slice(0, 12);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('-'));
  return `${(boundary >= 6 ? cut.slice(0, boundary) : cut.slice(0, 11)).trim()}…`;
}

function Contender({
  name,
  score,
  lead,
  settled,
  tint,
  right,
  testID,
}: {
  name: string;
  score: string;
  lead: boolean;
  /** A finished duel has a winner, not a leader. */
  settled: boolean;
  tint: string;
  right?: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: right ? 'flex-end' : 'flex-start' }} testID={testID}>
      <Text className="text-2xs text-text-dim" numberOfLines={1}>{name}</Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 24, color: lead ? tint : colors.text, letterSpacing: 0, ...pixelFont() }}
      >
        {score}
      </Text>
      {lead ? (
        <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1.2, color: tint, ...pixelFont(false) }}>
          {settled ? 'WON' : 'LEADING'}
        </Text>
      ) : null}
    </View>
  );
}
