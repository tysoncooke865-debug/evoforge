import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useCoinTotal } from '@/data/coins';
import { useForgeChallenges } from '@/data/forge-challenges';
import { useDuelConfig, useDuelSweep, useWatchableDuels } from '@/data/forge-duel';
import { useCalloutSweepOnce } from '@/data/callouts';
import { CalloutList } from '@/ui/callouts/callout-list';
import { useFriends } from '@/data/social';
import { bucketChallenges, challengeRecord } from '@/domain/forge-challenge';
import { challengeHistory, winStreak } from '@/domain/challenge-progression';
import { DEFAULT_DUEL_CONFIG, countdown, formatCoins } from '@/domain/forge-duel';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChallengeCard } from '@/ui/challenges/challenge-card';
import { StreakBanner } from '@/ui/challenges/stakes-block';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { CoinBalance, useNow } from '@/ui/duel/duel-hud';

/**
 * FORGE DUELS — the hub.
 *
 * Priority order, because a duel screen's job is "what needs me": an offer or
 * an invite waiting on my answer, then the contests already running, then what
 * I have sent, then the duels I can watch, then history. The create-first
 * layout is deliberately not copied — an athlete with a live wager opens this
 * to check it, not to start another.
 *
 * IT SWEEPS ON OPEN. There is no scheduler in this product, so the first thing
 * the hub does is ask the server to expire dead invites and settle anything
 * whose window closed. That is why a duel that ended overnight is already
 * settled by the time it is looked at, and why nobody has to press a button to
 * receive a result.
 */
export default function ChallengesScreen() {
  const colors = useThemeColors();
  const { session } = useAuth();
  const myId = session?.user?.id ?? '';
  const challenges = useForgeChallenges();
  const friends = useFriends();
  const coins = useCoinTotal();
  const watchable = useWatchableDuels();
  const cfgQuery = useDuelConfig();
  const cfg = cfgQuery.data ?? DEFAULT_DUEL_CONFIG;
  const sweep = useDuelSweep();
  const todayIso = calendarToday();
  const nowMs = useNow();
  // Call outs settle in seconds, not fortnights, but they expire on the same
  // "no scheduler, so the hub is the clock" principle the duel sweep uses.
  useCalloutSweepOnce(Boolean(myId));

  // ONE sweep per mount, whatever re-renders. It is maintenance: it refreshes
  // the list itself when it changes something and says nothing when it does not.
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current || !myId) return;
    swept.current = true;
    sweep.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  if (challenges.isPending || friends.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="PLEDGE ON YOUR TRAINING" title="DUELS" />
        <SkeletonScreen cards={3} testID="challenges-loading" />
      </ScreenShell>
    );
  }

  if (challenges.isError) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="PLEDGE ON YOUR TRAINING" title="DUELS" />
        <GlowCard>
          <Text className="text-sm text-text-dim">
            We couldn&apos;t load your duels. Your training and your coins are safe.
          </Text>
          <View className="mt-s3">
            <NeonButton title="RETRY" variant="ghost" pixel onPress={() => void challenges.refetch()} testID="challenges-retry" />
          </View>
        </GlowCard>
      </ScreenShell>
    );
  }

  const rows = challenges.data ?? [];
  const friendList = friends.data ?? [];
  const { incoming, active, sent, finished } = bucketChallenges(rows, myId);
  const record = challengeRecord(rows, myId);
  const streak = winStreak(rows, myId);
  const history = challengeHistory(rows, myId);
  const balance = coins.data ?? 0;
  const canAfford = balance >= cfg.min_stake;
  const watchList = watchable.data ?? [];

  // An offer waiting on MY answer is the most urgent thing on this page — more
  // urgent than an invite, because coins are already at risk in that duel.
  const needsAnswer = active.filter((c) => c.pending_offer && !c.pending_offer.mine);
  const potAtRisk = active.reduce((sum, c) => sum + (c.i_am_challenger ? c.challenger_escrowed : c.opponent_escrowed), 0);

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="PLEDGE ON YOUR TRAINING"
        title="DUELS"
        right={<CoinBalance coins={coins.data ?? null} testID="challenges-balance" />}
      />

      {/* CALL OUTS FIRST when there are any: a set-length wager resolves in
          minutes, so anything waiting here is more urgent than a fortnight-long
          duel. It renders nothing at all when the athlete has none. */}
      <CalloutList />

      {/* THE SOLO BOARD IS GONE (v5.1). It was a staked plinko board, which is
          simulated gambling on a mechanics test regardless of where the coins came
          from — see docs/ENGAGEMENT_V5.md. Its replacement, the Forge Reveal, is
          not reachable from here BY DESIGN: a reveal is produced by training and
          claimed from the workout summary or the Home chip, and an entry point on
          a competitive page would be a third producer. */}

      {potAtRisk > 0 ? (
        <Text className="text-2xs text-text-mute" testID="challenges-at-risk">
          {formatCoins(potAtRisk)} of your coins are in escrow across {active.length}{' '}
          {active.length === 1 ? 'duel' : 'duels'}.
        </Text>
      ) : null}

      {needsAnswer.length > 0 ? (
        <>
          <SectionLabel>THEY RAISED</SectionLabel>
          {needsAnswer.map((c) => (
            <ChallengeCard key={`offer-${c.id}`} challenge={c} myId={myId} todayIso={todayIso} nowMs={nowMs} />
          ))}
        </>
      ) : null}

      {incoming.length > 0 ? (
        <>
          <SectionLabel>WAITING ON YOU</SectionLabel>
          {incoming.map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} nowMs={nowMs} />
          ))}
        </>
      ) : null}

      <SectionLabel>ACTIVE</SectionLabel>
      {active.length > 0 ? (
        active.map((c) => (
          <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} nowMs={nowMs} />
        ))
      ) : (
        <GlowCard testID="challenges-none-active">
          <Text className="text-sm text-text">No duel running.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            A Forge Duel is a pledge between friends, settled by your real training. Both of
            you put up coins you earned; the app reads your logged sessions and pays the winner.
            Raise it mid-duel if you both agree.
          </Text>
        </GlowCard>
      )}

      {/* THE ONE CTA, and it says why it might not work before it is pressed. */}
      <NeonButton
        title="START A DUEL"
        size="hero"
        pixel
        disabled={friendList.length === 0 || !canAfford}
        onPress={() => router.push('/challenges/new' as never)}
        testID="challenge-create"
      />
      {friendList.length === 0 ? (
        <Text className="text-center text-2xs text-text-mute" testID="challenges-no-friends">
          A duel needs someone to duel. Add a friend in Social first — duels are between people who
          already know each other, never strangers.
        </Text>
      ) : !canAfford ? (
        <Text className="text-center text-2xs text-text-mute" testID="challenges-no-coins">
          You need at least {cfg.min_stake} coins to stake. Coins come from training — finishing
          workouts, hitting PRs and holding streaks. They are never purchasable.
        </Text>
      ) : null}

      {sent.length > 0 ? (
        <>
          <SectionLabel>SENT · AWAITING REPLY</SectionLabel>
          {sent.map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} nowMs={nowMs} />
          ))}
        </>
      ) : null}

      {/* ── THE CROWD SIDE: friends' duels I can watch and back. ── */}
      {watchList.length > 0 ? (
        <>
          <SectionLabel>WATCH & BACK</SectionLabel>
          {watchList.map((w) => {
            const leaderName =
              w.leader_id === w.challenger_id ? w.challenger_name
                : w.leader_id === w.opponent_id ? w.opponent_name
                  : null;
            return (
              <Pressable
                key={w.id}
                onPress={() => router.push(`/challenges/watch/${w.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`Watch ${w.challenger_name} against ${w.opponent_name}`}
                testID={`duel-watch-${w.id}`}
                className="w-full rounded-xl border p-s3"
                style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)', minHeight: 44 }}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-text" numberOfLines={1} style={{ flex: 1 }}>
                    {w.challenger_name} vs {w.opponent_name}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    style={{ fontSize: 14, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
                  >
                    {formatCoins(w.pot)}
                  </Text>
                </View>
                <View className="mt-s1 flex-row items-center justify-between">
                  <Text className="text-2xs text-text-mute" numberOfLines={1}>
                    {leaderName ? `${leaderName} leads` : 'Level'}
                  </Text>
                  <Text className="text-2xs text-text-mute">
                    {countdown(Date.parse(w.ends_at) - nowMs)} left
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {/* THE RUN — above the record, because a streak is a reason to act and a
          lifetime tally is a reason to reflect. */}
      <StreakBanner
        current={streak.current}
        best={streak.best}
        nextMilestone={streak.nextMilestone}
        toNext={streak.toNext}
        testID="hub-streak"
      />

      {finished.length > 0 ? (
        <>
          <SectionLabel>YOUR RECORD</SectionLabel>
          <GlowCard testID="challenge-record">
            <View className="flex-row flex-wrap" style={{ columnGap: 20, rowGap: 10 }}>
              <Stat label="WINS" value={String(record.wins)} tint={colors.success} />
              <Stat label="LOSSES" value={String(record.losses)} />
              <Stat label="DRAWS" value={String(record.draws)} />
              <Stat label="COINS WON" value={formatCoins(record.coinsWon)} tint={colors.legendary} />
            </View>

            {history.recent.length > 0 ? (
              <View className="mt-s3 border-t pt-s3" style={{ borderColor: colors.border }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  {history.recent.map((h) => (
                    <View
                      key={h.id}
                      accessibilityLabel={`${h.result} against ${h.opponent}`}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor:
                          h.result === 'won' ? `${colors.success}8c`
                            : h.result === 'lost' ? colors.border
                              : `${colors.legendary}66`,
                        backgroundColor: h.result === 'won' ? 'rgba(52,211,153,0.12)' : 'transparent',
                      }}
                    >
                      <Text
                        allowFontScaling={false}
                        style={{
                          fontSize: 10,
                          color:
                            h.result === 'won' ? colors.success
                              : h.result === 'drew' ? colors.legendary
                                : colors['text-mute'],
                          ...pixelFont(),
                        }}
                      >
                        {h.result === 'won' ? 'W' : h.result === 'lost' ? 'L' : 'D'}
                      </Text>
                    </View>
                  ))}
                  <View style={{ flex: 1 }} />
                  {history.biggestWin > 0 ? (
                    <Text className="text-2xs text-text-mute" numberOfLines={1}>
                      BEST +{history.biggestWin}
                    </Text>
                  ) : null}
                </View>
                {/* Net coins is shown as-is and CAN be negative: a record that
                    only ever counts up is not a record. */}
                <Text className="mt-s2 text-2xs text-text-mute">
                  {history.totalSettled} settled ·{' '}
                  <Text style={{ color: history.netCoins >= 0 ? colors.success : colors['text-dim'] }}>
                    {history.netCoins >= 0 ? '+' : ''}
                    {formatCoins(history.netCoins)} coins net
                  </Text>
                </Text>
              </View>
            ) : null}
          </GlowCard>

          <SectionLabel>HISTORY</SectionLabel>
          {finished.slice(0, 10).map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} nowMs={nowMs} />
          ))}
        </>
      ) : null}

      {/* DAMAGE ASSESSMENT (migration 038) — the OTHER way to challenge a
          friend, and the only other thing that survived the Arena's retirement
          (Tyson, 2026-08-07). It lived only inside the Arena hub, so removing
          that tab would have stranded a working feature. Same tab, because both
          are friend-vs-friend contests. */}
      <SectionLabel>DAMAGE ASSESSMENT</SectionLabel>
      <Pressable
        onPress={() => router.push('/damage' as never)}
        accessibilityRole="button"
        accessibilityLabel="Damage Assessment: a pre and post pump photo duel against a friend."
        testID="challenges-damage"
        className="w-full rounded-xl border p-s3"
        style={{ borderColor: `${colors.danger}45`, backgroundColor: 'rgba(13,21,36,0.55)', minHeight: 44 }}
      >
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Text style={{ fontSize: 20 }}>📸</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              allowFontScaling={false}
              style={{ fontSize: 11, letterSpacing: 1.2, color: colors.danger, ...pixelFont(false) }}
            >
              DAMAGE ASSESSMENT
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              PRE photo, train, POST photo — the AI judges whose physique changed most. No coins
              are staked.
            </Text>
          </View>
          <Text className="text-base font-bold" style={{ color: colors.danger }}>›</Text>
        </View>
      </Pressable>

      {/* Said once, at the bottom, on every screen where a wager is agreed to. */}
      <Text className="text-2xs text-text-mute" testID="challenges-safety">
        Forge Coins are earned by training. They cannot be bought, cashed out or transferred, and a
        duel never touches your XP, Evo Rating, Forge Level or Training Arc.
      </Text>
    </ScreenShell>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 20, color: tint ?? colors.text, letterSpacing: 0, ...pixelFont() }}
      >
        {value}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}
