import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useCoinTotal } from '@/data/coins';
import {
  useAcceptChallenge,
  useCancelChallenge,
  useCreateChallenge,
  useDeclineChallenge,
  useDisputeChallenge,
  useForgeChallenges,
  useSettleChallenge,
} from '@/data/forge-challenges';
import {
  useDuelConfig,
  useDuelTimeline,
  useProposeOffer,
  useRespondOffer,
  useRivalry,
  useWithdrawOffer,
} from '@/data/forge-duel';
import { useDisplayIdentity } from '@/data/use-display-identity';
import type { Branch } from '@/domain/avatar-stats';
import { confidenceOf } from '@/domain/challenge-progression';
import {
  CHALLENGE_INFO,
  SAFETY_NOTE,
  STATUS_LABEL,
  challengeDay,
  isExpired,
  isSettleable,
  msToExpiry,
  myCoinDelta,
  myEscrow,
  myResult,
  potOf,
  settledPot,
  sideLabel,
  sideScore,
  sidesOf,
  type ForgeChallenge,
} from '@/domain/forge-challenge';
import { DEFAULT_DUEL_CONFIG, countdown, formatCoins, unitLabel } from '@/domain/forge-duel';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { VersusHero } from '@/ui/challenges/versus-hero';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { AtRiskGrid, CoinBalance, DuelCountdown, DuelRow, useNow } from '@/ui/duel/duel-hud';
import { DuelResult } from '@/ui/duel/duel-result';
import { DuelCardLabel, DuelTimeline } from '@/ui/duel/duel-timeline';
import { ForgePot } from '@/ui/duel/forge-pot';
import {
  AllInSheet,
  IncomingOfferCard,
  PendingOfferCard,
  RaiseButton,
  RaiseSheet,
} from '@/ui/duel/offer-sheet';
import { RivalryCard } from '@/ui/duel/rivalry-card';

/**
 * ONE DUEL, in full — and ONE screen for its whole life: the invite, the live
 * contest, the negotiation and the result.
 *
 * THE ORDER IS THE ARGUMENT. Status, the two athletes, the score, the pot, the
 * clock, then the one thing to do — and everything explanatory below that. The
 * old screen led with a card explaining what a draw refunds; this one leads
 * with who is winning and how much is on the table, which is what the athlete
 * opened it for. The explanations did not disappear, they stopped competing
 * with the competition.
 *
 * Deliberately not three screens and not a chain of modals. The result state
 * is this page with the result at the top, so "how did it end" and "what were
 * the numbers" are the same view the athlete has been watching for a fortnight.
 */
export default function ChallengeDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { session } = useAuth();
  const myId = session?.user?.id ?? '';
  const challenges = useForgeChallenges();
  const todayIso = calendarToday();

  if (challenges.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE DUEL" title="DUEL" onBack={() => router.back()} />
        <SkeletonScreen cards={3} testID="challenge-detail-loading" />
      </ScreenShell>
    );
  }

  const c = (challenges.data ?? []).find((x) => x.id === id) ?? null;
  if (c === null) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE DUEL" title="DUEL" onBack={() => router.back()} />
        <GlowCard>
          <Text className="text-sm text-text">This duel is not yours to see.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            It may have been cancelled, or it belongs to someone else.
          </Text>
          <View className="mt-s3">
            <NeonButton title="BACK TO DUELS" variant="ghost" pixel onPress={() => router.replace('/challenges' as never)} testID="challenge-missing-back" />
          </View>
        </GlowCard>
      </ScreenShell>
    );
  }

  return <DuelBody c={c} myId={myId} todayIso={todayIso} />;
}

function DuelBody({ c, myId, todayIso }: { c: ForgeChallenge; myId: string; todayIso: string }) {
  const colors = useThemeColors();
  const nowMs = useNow();
  const accept = useAcceptChallenge();
  const decline = useDeclineChallenge();
  const cancel = useCancelChallenge();
  const settle = useSettleChallenge();
  const dispute = useDisputeChallenge();
  const create = useCreateChallenge();
  const propose = useProposeOffer();
  const respond = useRespondOffer();
  const withdraw = useWithdrawOffer();
  const coins = useCoinTotal();
  const cfgQuery = useDuelConfig();
  const cfg = cfgQuery.data ?? DEFAULT_DUEL_CONFIG;

  const [showRules, setShowRules] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState<'none' | 'raise' | 'all_in'>('none');

  const info = CHALLENGE_INFO[c.challenge_type];
  const { me, them, myName, theirName, theirId } = sidesOf(c);
  const result = myResult(c, myId);
  const { day, of } = challengeDay(c, todayIso);
  const live = c.status === 'active' || c.status === 'awaiting_settlement';
  const expired = isExpired(c, nowMs);
  const settleable = isSettleable(c, nowMs);
  const incoming = c.status === 'pending' && c.opponent_id === myId;
  const sent = c.status === 'pending' && c.challenger_id === myId;
  const balance = coins.data ?? 0;

  const timeline = useDuelTimeline(c.id, c.status !== 'pending');
  const rivalry = useRivalry(theirId);

  /**
   * SETTLE ON OPEN. There is no scheduler in this product, so the moment a
   * participant looks at a finished duel IS the moment it can settle — and a
   * result the athlete has to press a button to receive is a result they will
   * find already spoiled by a notification. Guarded by a ref: one attempt per
   * mount, whatever re-renders.
   */
  const settledOnce = useRef(false);
  useEffect(() => {
    if (!settleable || settledOnce.current || settle.isPending) return;
    settledOnce.current = true;
    settle.mutate(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleable, c.id]);

  // The two scores, restated from what the server already returned — never
  // computed here, only formatted.
  const myScore = sideScore(c, me);
  const theirScore = sideScore(c, them);
  const top = Math.max(Math.abs(myScore), Math.abs(theirScore));
  const fill = (v: number) => (top <= 0 ? 0 : Math.max(0, v) / top);
  const gap = myScore - theirScore;
  const gapLabel =
    gap === 0
      ? null
      : c.challenge_type === 'most_improved_lift'
        ? `${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}%`
        : `${gap > 0 ? '+' : '−'}${unitLabel(Math.abs(gap), info.unit)}`;
  const confidence = confidenceOf(c, myId);

  const identity = useDisplayIdentity();
  // A neutral mid-stage silhouette. NOT a guess at their real form — EvoForge
  // does not publish another athlete's Origin, and inventing art for them
  // would leak a choice they never made public.
  const theirBranch: Branch = 'hybrid';
  const theirStage = 3;

  const tint = result === 'won' ? colors.success
    : result === 'lost' ? colors['text-dim']
      : c.disputed ? colors.warn
        : colors.accent;

  const offer = c.pending_offer;
  const busyOffer = propose.isPending || respond.isPending || withdraw.isPending;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={live && day > 0 ? `DAY ${day} OF ${of}` : STATUS_LABEL[c.status]}
        title="FORGE DUEL"
        onBack={() => router.back()}
        right={
          live ? (
            <DuelCountdown endsAt={c.ends_at} nowMs={nowMs} testID="duel-countdown" />
          ) : (
            <CoinBalance coins={coins.data ?? null} testID="duel-balance" />
          )
        }
      />

      {/* ── THE RESULT, when there is one. Top of the page, said once. ── */}
      {result ? (
        <GlowCard glow={tint} testID="challenge-result">
          <DuelResult
            outcome={result}
            myScoreLabel={sideLabel(c, me)}
            theirScoreLabel={sideLabel(c, them)}
            theirName={theirName}
            pot={settledPot(c)}
            coinDelta={myCoinDelta(c, myId)}
            balanceAfter={coins.data ?? null}
            testID="duel-result"
          />
        </GlowCard>
      ) : null}

      {/* ── THE ARENA. Two champions, both scores, both rails, the lead. ── */}
      <GlowCard testID="challenge-compare">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.4 }}>
            {info.name}
          </Text>
          {c.raises_accepted > 0 ? (
            <Text
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.2, color: colors.legendary, ...pixelFont(false) }}
              testID="duel-raise-count"
            >
              {c.raises_accepted} {c.raises_accepted === 1 ? 'RAISE' : 'RAISES'}
            </Text>
          ) : null}
        </View>
        <View className="mt-s3">
          <VersusHero
            myName="YOU"
            myScore={sideLabel(c, me)}
            mySource={identity.stillSource ?? null}
            theirName={theirName}
            theirScore={sideLabel(c, them)}
            theirBranch={theirBranch}
            theirStage={theirStage}
            unit={c.challenge_type === 'most_improved_lift' ? 'improvement' : info.unit}
            confidence={confidence}
            live={live}
            myFill={fill(myScore)}
            theirFill={fill(theirScore)}
            gapLabel={gapLabel}
            leaderId={c.status === 'settled' ? c.winner_id : c.leader_id}
            myId={myId}
            testID="challenge-versus"
          />
        </View>

        {/* The two raw numbers behind a percentage — ONLY for a lift duel. A
            count is its own explanation, and a percentage the athlete cannot
            check is a number they have to take on trust. */}
        {c.challenge_type === 'most_improved_lift' ? (
          <View className="mt-s3 flex-row" style={{ gap: 12 }}>
            <BaselineLine
              label="YOU"
              baseline={c.i_am_challenger ? c.challenger_baseline : c.opponent_baseline}
              current={c.i_am_challenger ? c.challenger_current?.value ?? null : c.opponent_current?.value ?? null}
              unit={info.unit}
            />
            <BaselineLine
              label={theirName.toUpperCase()}
              baseline={c.i_am_challenger ? c.opponent_baseline : c.challenger_baseline}
              current={c.i_am_challenger ? c.opponent_current?.value ?? null : c.challenger_current?.value ?? null}
              unit={info.unit}
            />
          </View>
        ) : null}
      </GlowCard>

      {/* ── THE POT. The strongest number on the page while it is live. ── */}
      {c.status !== 'pending' ? (
        <ForgePot
          pot={result ? settledPot(c) : potOf(c)}
          perAthlete={myEscrow(c, myId)}
          label={result ? 'FINAL POOL' : 'CURRENT POOL'}
          note={
            result
              ? c.outcome === 'draw' ? 'Refunded to both of you' : 'Settled'
              : `${formatCoins(myEscrow(c, myId))} from each of you · in escrow`
          }
          testID="duel-pot"
        />
      ) : null}

      {/* ── THE LIVE NEGOTIATION ──
          Shown while the duel is PENDING too, which is where a counter-stake
          lives. The browser tour found this the hard way: the challenger got
          the AWAITING screen with no sign that their friend had answered with
          a different number, so the whole negotiation was invisible from the
          side that had to agree to it. */}
      {offer && (live || c.status === 'pending') ? (
        offer.mine ? (
          <PendingOfferCard
            offer={offer}
            theirName={theirName}
            nowMs={nowMs}
            busy={busyOffer}
            onWithdraw={() => withdraw.mutate({ offerId: offer.id, challengeId: c.id })}
            testID="duel-offer-mine"
          />
        ) : (
          <IncomingOfferCard
            offer={offer}
            theirName={theirName}
            currentPot={potOf(c)}
            balance={balance}
            config={cfg}
            nowMs={nowMs}
            busy={busyOffer}
            onAccept={() => respond.mutate({ offerId: offer.id, accept: true, challengeId: c.id })}
            onDecline={() => respond.mutate({ offerId: offer.id, accept: false, challengeId: c.id })}
            onCounter={(amount) =>
              propose.mutate({
                challengeId: c.id,
                kind: offer.kind === 'counter_stake' ? 'counter_stake' : 'raise',
                amount,
                counterOf: offer.id,
              })
            }
            testID="duel-offer-incoming"
          />
        )
      ) : null}

      {/* ── WHAT TO DO ── */}
      {incoming && !expired ? (
        <IncomingInvite
          c={c}
          theirName={theirName}
          balance={balance}
          nowMs={nowMs}
          busy={accept.isPending || busyOffer}
          onAccept={() => accept.mutate(c.id)}
          onDecline={() => decline.mutate(c.id, { onSuccess: () => router.replace('/challenges' as never) })}
          onCounter={(amount) =>
            propose.mutate({ challengeId: c.id, kind: 'counter_stake', amount })
          }
          hasOffer={Boolean(offer)}
        />
      ) : null}

      {incoming && expired ? (
        <GlowCard testID="challenge-expired">
          <Text className="text-sm text-text">This invite has expired.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            Nothing was staked. Send one back if you still want it.
          </Text>
        </GlowCard>
      ) : null}

      {sent ? (
        <AwaitingReply
          theirName={theirName}
          stake={c.stake}
          msLeft={msToExpiry(c, nowMs)}
          busy={cancel.isPending}
          onWithdraw={() => cancel.mutate(c.id, { onSuccess: () => router.replace('/challenges' as never) })}
          onRules={() => setShowRules(true)}
        />
      ) : null}

      {live ? (
        <>
          <NeonButton
            title="LOG A WORKOUT"
            size="hero"
            pixel
            onPress={() => router.push('/today' as never)}
            testID="challenge-log-workout"
          />
          {!offer ? (
            <RaiseButton
              state={c.raise_state}
              myName={myName}
              onPress={() => setSheet('raise')}
              testID="duel-raise"
            />
          ) : null}
          {settleable ? (
            <NeonButton
              title={settle.isPending ? 'SETTLING…' : 'SETTLE THIS DUEL'}
              pixel
              busy={settle.isPending}
              onPress={() => settle.mutate(c.id)}
              testID="challenge-settle"
            />
          ) : null}
        </>
      ) : null}

      {result ? (
        <>
          <NeonButton
            title="REMATCH"
            size="hero"
            pixel
            busy={create.isPending}
            onPress={() =>
              create.mutate(
                {
                  opponentId: theirId,
                  challengeType: c.challenge_type,
                  metricKey: c.metric_key,
                  durationDays: c.duration_days,
                  stake: c.stake,
                  rematchOf: c.id,
                },
                { onSuccess: () => router.replace('/challenges' as never) }
              )
            }
            testID="challenge-rematch"
          />
          {/* DOUBLE OR NOTHING IS A NEW DUEL, never a change to this one. The
              finished result is a record; re-scoring it would be rewriting
              history to settle a rematch. */}
          <NeonButton
            title={`DOUBLE OR NOTHING · ${formatCoins(Math.min(c.stake * 2, balance))}`}
            variant="ghost"
            pixel
            disabled={create.isPending || balance < Math.min(c.stake * 2, cfg.min_stake)}
            onPress={() =>
              create.mutate(
                {
                  opponentId: theirId,
                  challengeType: c.challenge_type,
                  metricKey: c.metric_key,
                  durationDays: c.duration_days,
                  stake: Math.max(cfg.min_stake, Math.min(c.stake * 2, balance, cfg.max_stake)),
                  rematchOf: c.id,
                },
                { onSuccess: () => router.replace('/challenges' as never) }
              )
            }
            testID="challenge-double"
          />
        </>
      ) : null}

      {c.disputed ? (
        <GlowCard glow={colors.warn} testID="challenge-disputed">
          <Text className="text-sm" style={{ color: colors.warn }}>Settlement is paused.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            A dispute is open on this duel. The coins stay in escrow — nobody is paid and
            nobody loses their pledge — until it is reviewed.
          </Text>
        </GlowCard>
      ) : null}

      {/* ── THE STORY BETWEEN SESSIONS ── */}
      {c.status !== 'pending' ? (
        <GlowCard testID="duel-timeline-card">
          <DuelCardLabel>DUEL LOG</DuelCardLabel>
          <View className="mt-s3">
            <DuelTimeline
              events={timeline.data ?? []}
              myId={myId}
              myName={myName}
              loading={timeline.isPending}
              testID="duel-timeline"
            />
          </View>
        </GlowCard>
      ) : null}

      {/*
        THE CROWD CARD IS RETIRED (V5_MIGRATION_AUDIT.md §4, migration 164).

        It showed a supporter book on this duel — two sides, a pool, and a cut of
        the losing side. The server functions are gone, so it rendered a meter over
        columns nothing writes. Spectators still exist and can still watch and
        react; they simply cannot stake on the outcome.
      */}

      {/* ── WHAT IS ACTUALLY AT RISK ── */}
      <GlowCard testID="challenge-escrow">
        <DuelCardLabel>ON THE LINE</DuelCardLabel>
        <View className="mt-s3">
          <AtRiskGrid stake={myEscrow(c, myId)} testID="challenge-stakes" />
        </View>
      </GlowCard>

      {/* ── THE RIVALRY, collapsed. A reason to reflect, under the reasons to act. ── */}
      {rivalry.data && rivalry.data.total > 0 ? (
        <RivalryCard rivalry={rivalry.data} myName={myName} testID="duel-rivalry" />
      ) : null}

      {/* ── THE RULES, always reachable, never in the way ── */}
      <Pressable
        onPress={() => setShowRules((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showRules }}
        accessibilityLabel={showRules ? 'Hide the duel rules' : 'View the duel rules'}
        testID="challenge-view-rules"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text className="text-2xs" style={{ color: colors.accent, letterSpacing: 0.8 }}>
          {showRules ? 'HIDE RULES ›' : 'VIEW DUEL RULES ›'}
        </Text>
      </Pressable>
      {showRules ? (
        <GlowCard testID="challenge-rules-body">
          <DuelRow k="MEASURED" v={info.measures} />
          <DuelRow k="WINNER" v={info.winner} />
          <DuelRow k="COUNTS" v={info.counts.join(' · ')} />
          <DuelRow k="DOES NOT COUNT" v={info.doesNotCount.join(' · ')} />
          <DuelRow k="A DRAW" v="Refunds every pledge in full." />
          <DuelRow k="CANCELLING" v="Refunds every pledge in full." />
          <DuelRow k="RAISING" v={`Both of you must agree. Up to ${cfg.max_raises} raises, and one unlocks each time you have both trained since the last.`} />
          <DuelRow k="WATCHING" v="Friends can follow this duel and react. Nobody can put coins on it but the two of you." />
          <DuelRow k="RULES" v="The duel's type, length and opening pledge locked when it was accepted." />
          <Text className="mt-s3 text-2xs text-text-mute">{SAFETY_NOTE}</Text>
        </GlowCard>
      ) : null}

      {/* ── DISPUTE ── */}
      {live || result ? (
        <>
          <Pressable
            onPress={() => setDisputeOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Report a problem with this duel"
            testID="challenge-dispute-open"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text className="text-2xs text-text-mute">Something wrong with this result? ›</Text>
          </Pressable>
          {disputeOpen ? (
            <GlowCard>
              <Text className="text-2xs text-text-dim">
                Tell us what looks wrong. Raising this pauses settlement — the coins stay in escrow
                until a human reviews it. Nobody can award themselves anything here.
              </Text>
              <TextInput
                className="mt-s2 min-h-[64px] rounded-md border bg-surface-2 px-s3 py-s2 text-sm text-text"
                style={{ borderColor: colors.border }}
                placeholder="What happened?"
                placeholderTextColor="#64758f"
                multiline
                value={reason}
                onChangeText={setReason}
                maxLength={1000}
                testID="challenge-dispute-reason"
              />
              <View className="mt-s2">
                <NeonButton
                  title={dispute.isPending ? 'SENDING…' : 'RAISE A DISPUTE'}
                  variant="ghost"
                  pixel
                  disabled={reason.trim().length < 3 || dispute.isPending}
                  busy={dispute.isPending}
                  onPress={() =>
                    dispute.mutate(
                      { challengeId: c.id, reason: reason.trim() },
                      { onSuccess: () => setDisputeOpen(false) }
                    )
                  }
                  testID="challenge-dispute-send"
                />
              </View>
            </GlowCard>
          ) : null}
        </>
      ) : null}

      {sheet === 'raise' ? (
        <RaiseSheet
          currentPot={potOf(c)}
          perAthlete={myEscrow(c, myId)}
          balance={balance}
          config={cfg}
          busy={propose.isPending}
          onSend={(amount) =>
            propose.mutate(
              { challengeId: c.id, kind: 'raise', amount },
              { onSuccess: () => setSheet('none') }
            )
          }
          onAllIn={() => setSheet('all_in')}
          onClose={() => setSheet('none')}
        />
      ) : null}

      {sheet === 'all_in' ? (
        <AllInSheet
          balance={balance}
          currentPot={potOf(c)}
          busy={propose.isPending}
          onConfirm={() =>
            propose.mutate(
              { challengeId: c.id, kind: 'all_in' },
              { onSuccess: () => setSheet('none') }
            )
          }
          onClose={() => setSheet('none')}
        />
      ) : null}
    </ScreenShell>
  );
}

/**
 * THE ACCEPTANCE EXPERIENCE — a negotiation, not a yes/no dialog.
 *
 * Three answers, because two is a false choice: an athlete who thinks 25 is
 * too small has nothing to say with ACCEPT and DECLINE, and the duel that
 * would have happened at 50 never does.
 */
function IncomingInvite({
  c,
  theirName,
  balance,
  nowMs,
  busy,
  onAccept,
  onDecline,
  onCounter,
  hasOffer,
}: {
  c: ForgeChallenge;
  theirName: string;
  balance: number;
  nowMs: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (amount: number) => void;
  hasOffer: boolean;
}) {
  const colors = useThemeColors();
  const cfgQuery = useDuelConfig();
  const cfg = cfgQuery.data ?? DEFAULT_DUEL_CONFIG;
  const [countering, setCountering] = useState(false);
  const [counter, setCounter] = useState(c.stake);
  const info = CHALLENGE_INFO[c.challenge_type];
  const canAfford = balance >= c.stake;
  const counterMax = Math.max(0, Math.min(balance, cfg.max_stake));

  return (
    <>
      <SectionLabel>YOUR MOVE</SectionLabel>
      <GlowCard glow={colors.accent} testID="duel-invite">
        <Text
          allowFontScaling={false}
          style={{ fontSize: 17, color: colors.accent, letterSpacing: 1, ...pixelFont() }}
        >
          {theirName.toUpperCase()} CHALLENGED YOU
        </Text>
        <View className="mt-s3 flex-row" style={{ gap: 8 }}>
          <Fact k="CONTEST" v={info.name} />
          <Fact k="LENGTH" v={`${c.duration_days} days`} />
        </View>
        <View className="mt-s2 flex-row" style={{ gap: 8 }}>
          <Fact k="PLEDGE EACH" v={formatCoins(c.stake)} tint={colors.text} />
          <Fact k="POT" v={formatCoins(c.stake * 2)} tint={colors.legendary} />
          <Fact k="EXPIRES IN" v={countdown(msToExpiry(c, nowMs))} />
        </View>
        <Text className="mt-s3 text-2xs text-text-dim">{info.winner}</Text>
        {!canAfford ? (
          <Text className="mt-s2 text-2xs" style={{ color: colors.warn }} testID="duel-invite-poor">
            You have {formatCoins(balance)} coins. Counter with something you can cover, or decline.
          </Text>
        ) : null}
        <Text className="mt-s2 text-2xs text-text-mute">{SAFETY_NOTE}</Text>
      </GlowCard>

      {countering && !hasOffer ? (
        <GlowCard testID="duel-counter-stake">
          <DuelCardLabel>COUNTER THE PLEDGE</DuelCardLabel>
          <Text className="mt-s1 text-2xs text-text-dim">
            Name your number. They accept or decline it, and nothing moves either way until they do.
          </Text>
          <View className="mt-s3">
            <ChipWagerTable
              value={counter}
              onChange={setCounter}
              balance={balance}
              min={cfg.min_stake}
              max={counterMax}
              potLabel="POOL AT YOUR NUMBER"
              testID="invite-counter-table"
            />
          </View>
          <View className="mt-s3">
            <NeonButton
              title={busy ? 'SENDING…' : `COUNTER AT ${formatCoins(counter)} EACH`}
              pixel
              disabled={counter < cfg.min_stake || busy}
              busy={busy}
              onPress={() => onCounter(counter)}
              testID="duel-counter-send"
            />
          </View>
          <NeonButton title="BACK" variant="ghost" pixel onPress={() => setCountering(false)} testID="duel-counter-back" />
        </GlowCard>
      ) : (
        <>
          <NeonButton
            title={busy ? 'ACCEPTING…' : `ACCEPT · PLEDGE ${formatCoins(c.stake)}`}
            size="hero"
            pixel
            disabled={!canAfford || busy}
            busy={busy}
            onPress={onAccept}
            testID="challenge-accept"
          />
          <View className="flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton
                title="COUNTER PLEDGE"
                variant="ghost"
                pixel
                disabled={busy || hasOffer || counterMax < cfg.min_stake}
                onPress={() => {
                  setCounter(Math.min(counterMax, c.stake));
                  setCountering(true);
                }}
                testID="challenge-counter"
              />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton title="DECLINE" variant="ghost" pixel disabled={busy} onPress={onDecline} testID="challenge-decline" />
            </View>
          </View>
        </>
      )}
    </>
  );
}

/**
 * WAITING, WITH A PULSE.
 *
 * The old state was one grey sentence ("Waiting for Jesse to accept. No coins
 * have moved.") on an otherwise empty page, which read as a dead end rather
 * than a live invite. Same facts, arranged as a status: what was sent, what it
 * would cost, that nothing is locked yet, and how long they have.
 */
function AwaitingReply({
  theirName,
  stake,
  msLeft,
  busy,
  onWithdraw,
  onRules,
}: {
  theirName: string;
  stake: number;
  msLeft: number;
  busy: boolean;
  onWithdraw: () => void;
  onRules: () => void;
}) {
  const colors = useThemeColors();
  return (
    <>
      <GlowCard glow={colors.accent} testID="duel-awaiting">
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <WaitingDots />
          <Text
            allowFontScaling={false}
            style={{ fontSize: 17, color: colors.accent, letterSpacing: 1, ...pixelFont() }}
          >
            AWAITING {theirName.toUpperCase()}
          </Text>
        </View>
        <View className="mt-s3 flex-row" style={{ gap: 8 }}>
          <Fact k="PLEDGE SENT" v={formatCoins(stake)} />
          <Fact k="LOCKED SO FAR" v="0" tint={colors.success} />
          <Fact k="EXPIRES IN" v={countdown(msLeft)} />
        </View>
        <Text className="mt-s3 text-2xs text-text-mute">
          No coins move until they accept. They can also counter with a different number.
        </Text>
      </GlowCard>
      <View className="flex-row" style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <NeonButton title="WITHDRAW" variant="ghost" pixel disabled={busy} onPress={onWithdraw} testID="challenge-withdraw" />
        </View>
        <View style={{ flex: 1 }}>
          <NeonButton title="VIEW RULES" variant="ghost" pixel onPress={onRules} testID="duel-awaiting-rules" />
        </View>
      </View>
    </>
  );
}

/** Three dots that breathe. The one piece of motion on a waiting screen, and
 *  it exists to say "this is live", which is the whole question. */
function WaitingDots() {
  const colors = useThemeColors();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 3), 480);
    return () => clearInterval(t);
  }, []);
  return (
    <View className="flex-row" style={{ gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.accent,
            opacity: i === step ? 1 : 0.28,
          }}
        />
      ))}
    </View>
  );
}

function Fact({ k, v, tint }: { k: string; v: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border px-s2 py-s2"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(4,7,14,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 8, letterSpacing: 1.1, ...pixelFont(false) }}
      >
        {k}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 15, color: tint ?? colors.text, letterSpacing: 0, ...pixelFont() }}>
        {v}
      </Text>
    </View>
  );
}

/**
 * The two raw numbers behind a percentage — start, and now. ONLY for a lift
 * duel: a percentage the athlete cannot check is a number they have to take on
 * trust, and the whole point of settling from logged training is that they
 * never have to.
 */
function BaselineLine({
  label,
  baseline,
  current,
  unit,
}: {
  label: string;
  baseline: number | null;
  current: number | null;
  unit: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        className="text-text-mute"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 7, letterSpacing: 1.2, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text className="mt-s1 text-2xs" numberOfLines={1} style={{ color: colors['text-dim'] }}>
        {baseline !== null && baseline > 0
          ? `${baseline} → ${current ?? 0} ${unit}`
          : `no starting lift · ${current ?? 0} ${unit}`}
      </Text>
    </View>
  );
}
