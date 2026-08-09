import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import {
  useDuelTimeline,
  useDuelWatch,
  useReactToDuel,
} from '@/data/forge-duel';
import { CHALLENGE_INFO, type ChallengeType } from '@/domain/forge-challenge';
import { countdown, unitLabel, type DuelReactionKey } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { DuelCountdown, useNow } from '@/ui/duel/duel-hud';
import { DuelCardLabel, DuelTimeline } from '@/ui/duel/duel-timeline';
import { ForgePot } from '@/ui/duel/forge-pot';
import { DuelReactions } from '@/ui/duel/duel-reactions';

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
  const react = useReactToDuel();

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
  const settled = d.status === 'settled';

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


  return (
    <ScreenShell>
      <ScreenHeader
        kicker={settled ? 'SETTLED' : 'SPECTATING'}
        title="THE DUEL"
        onBack={() => router.back()}
        right={
          /* A spectator's own balance used to sit here, because a settled duel was
             the moment supporters got paid. With third-party staking retired
             (164) nothing about this screen can move their coins, so showing a
             wallet on it is a leftover that implies otherwise. */
          settled ? null : (
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

      {/*
        THE CROWD CARD IS GONE, AND NOT COMING BACK.

        It held a two-sided supporter book on somebody else's duel: BACK one
        athlete, share the LOSING side's pool in proportion to your stake, with a
        configurable platform cut. That is a bookmaker with a fitness skin, and
        V5_MIGRATION_AUDIT.md §4 retired it (migration 164 dropped the functions;
        `forge_duel_support` no longer exists, so this UI had been calling a
        function that was not there).

        WATCHING SURVIVES, deliberately. The score, the pot between the two
        athletes, the timeline and reactions are all still here — spectating a
        friend's duel was never the mechanic that was rejected. What is gone is
        the ability to put coins on it.

        Do not restore this as a Golden Dot pool. BACK/PUSH belongs to the
        athlete's own pledge on their own planned set; aiming it at a third
        party's duel is the same mechanic under an approved word.
      */}

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
