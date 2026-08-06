import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useCoinTotal } from '@/data/coins';
import { useForgeChallenges } from '@/data/forge-challenges';
import { useFriends } from '@/data/social';
import {
  CHALLENGE_STAKES,
  SAFETY_NOTE,
  bucketChallenges,
  challengeRecord,
} from '@/domain/forge-challenge';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChallengeCard } from '@/ui/challenges/challenge-card';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';

/**
 * FORGE CHALLENGES — the hub.
 *
 * Priority order, because a challenge screen's job is "what needs me": an
 * invite waiting on my answer, then the contests already running, then what I
 * have sent, then history. The Arena's create-first layout is deliberately not
 * copied — an athlete with a live wager opens this to check it, not to start
 * another.
 *
 * Nothing here is combat. Static cards, real training numbers, a coin escrow.
 */
export default function ChallengesScreen() {
  const colors = useThemeColors();
  const { session } = useAuth();
  const myId = session?.user?.id ?? '';
  const challenges = useForgeChallenges();
  const friends = useFriends();
  const coins = useCoinTotal();
  const todayIso = calendarToday();

  if (challenges.isPending || friends.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="STAKE YOUR TRAINING" title="CHALLENGES" />
        <SkeletonScreen cards={3} testID="challenges-loading" />
      </ScreenShell>
    );
  }

  if (challenges.isError) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="STAKE YOUR TRAINING" title="CHALLENGES" />
        <GlowCard>
          <Text className="text-sm text-text-dim">
            We couldn&apos;t load your challenges. Your training and your coins are safe.
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
  const balance = coins.data ?? 0;
  const canAfford = balance >= CHALLENGE_STAKES[0];

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="STAKE YOUR TRAINING"
        title="CHALLENGES"
        right={
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <CoinIcon size={22} />
            <Text
              allowFontScaling={false}
              testID="challenges-balance"
              style={{ fontSize: 18, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
            >
              {balance}
            </Text>
          </View>
        }
      />

      {/* THE ONE CTA, and it says why it might not work before it is pressed. */}
      <NeonButton
        title="CREATE A CHALLENGE"
        size="hero"
        pixel
        disabled={friendList.length === 0 || !canAfford}
        onPress={() => router.push('/challenges/new' as never)}
        testID="challenge-create"
      />
      {friendList.length === 0 ? (
        <Text className="text-center text-2xs text-text-mute" testID="challenges-no-friends">
          A challenge needs someone to challenge. Add a friend in Social first — challenges are
          between people who already know each other, never strangers.
        </Text>
      ) : !canAfford ? (
        <Text className="text-center text-2xs text-text-mute" testID="challenges-no-coins">
          You need at least {CHALLENGE_STAKES[0]} coins to stake. Coins come from training —
          finishing workouts, hitting PRs and holding streaks. They are never purchasable.
        </Text>
      ) : null}

      {incoming.length > 0 ? (
        <>
          <SectionLabel>WAITING ON YOU</SectionLabel>
          {incoming.map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} />
          ))}
        </>
      ) : null}

      <SectionLabel>ACTIVE</SectionLabel>
      {active.length > 0 ? (
        active.map((c) => <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} />)
      ) : (
        <GlowCard testID="challenges-none-active">
          <Text className="text-sm text-text">No challenge running.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            A Forge Challenge is a friendly wager settled by your real training — most improved
            lift, training consistency, or cardio minutes. Both of you stake coins you earned; the
            app reads your logged sessions and pays the winner. A draw refunds you both.
          </Text>
        </GlowCard>
      )}

      {sent.length > 0 ? (
        <>
          <SectionLabel>SENT · AWAITING REPLY</SectionLabel>
          {sent.map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} />
          ))}
        </>
      ) : null}

      {finished.length > 0 ? (
        <>
          <SectionLabel>YOUR RECORD</SectionLabel>
          <GlowCard testID="challenge-record">
            <View className="flex-row flex-wrap" style={{ columnGap: 20, rowGap: 10 }}>
              <Stat label="WINS" value={String(record.wins)} tint={colors.success} />
              <Stat label="LOSSES" value={String(record.losses)} />
              <Stat label="DRAWS" value={String(record.draws)} />
              <Stat label="COINS WON" value={String(record.coinsWon)} tint={colors.legendary} />
            </View>
          </GlowCard>

          <SectionLabel>HISTORY</SectionLabel>
          {finished.map((c) => (
            <ChallengeCard key={c.id} challenge={c} myId={myId} todayIso={todayIso} />
          ))}
        </>
      ) : null}

      {/* Said once, at the bottom, on every screen where a wager is agreed to. */}
      <Text className="text-2xs text-text-mute" testID="challenges-safety">
        {SAFETY_NOTE}
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
