import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
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
  CHALLENGE_INFO,
  SAFETY_NOTE,
  STATUS_LABEL,
  challengeDay,
  challengeProgress,
  isExpired,
  isSettleable,
  leaderOf,
  myResult,
  sideLabel,
  sideScore,
  sidesOf,
  type ChallengeDuration,
  type ChallengeStake,
  type ForgeChallenge,
} from '@/domain/forge-challenge';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';

/**
 * ONE CHALLENGE, in full — and ONE screen for its whole life: the invite, the
 * live contest, and the result.
 *
 * Deliberately not three screens and not a sequence of modals. The completion
 * state is this page with the result at the top, so "how did it end" and "what
 * were the numbers" are the same view the athlete has been watching for two
 * weeks. The brief's rule: one clear result screen, no blocking modal chain.
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
        <ScreenHeader kicker="FORGE CHALLENGE" title="CHALLENGE" onBack={() => router.back()} />
        <SkeletonScreen cards={3} testID="challenge-detail-loading" />
      </ScreenShell>
    );
  }

  const c = (challenges.data ?? []).find((x) => x.id === id) ?? null;
  if (c === null) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE CHALLENGE" title="CHALLENGE" onBack={() => router.back()} />
        <GlowCard>
          <Text className="text-sm text-text">This challenge is not yours to see.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            It may have been cancelled, or it belongs to someone else.
          </Text>
          <View className="mt-s3">
            <NeonButton title="BACK TO CHALLENGES" variant="ghost" pixel onPress={() => router.replace('/challenges' as never)} testID="challenge-missing-back" />
          </View>
        </GlowCard>
      </ScreenShell>
    );
  }

  return <ChallengeBody c={c} myId={myId} todayIso={todayIso} />;
}

function ChallengeBody({ c, myId, todayIso }: { c: ForgeChallenge; myId: string; todayIso: string }) {
  const colors = useThemeColors();
  const accept = useAcceptChallenge();
  const decline = useDeclineChallenge();
  const cancel = useCancelChallenge();
  const settle = useSettleChallenge();
  const dispute = useDisputeChallenge();
  const create = useCreateChallenge();
  const [showRules, setShowRules] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const info = CHALLENGE_INFO[c.challenge_type];
  const { me, them, myName, theirName, theirId } = sidesOf(c);
  const leader = leaderOf(c);
  const result = myResult(c, myId);
  const { day, of } = challengeDay(c, todayIso);
  const live = c.status === 'active' || c.status === 'awaiting_settlement';
  const nowMs = Date.parse(`${todayIso}T23:59:59Z`);
  const expired = isExpired(c, nowMs);
  const settleable = isSettleable(c, nowMs);
  const incoming = c.status === 'pending' && c.opponent_id === myId;
  const sent = c.status === 'pending' && c.challenger_id === myId;

  const myScore = sideScore(c, me);
  const theirScore = sideScore(c, them);
  const gap = Math.round(Math.abs(myScore - theirScore) * 10) / 10;

  const tint = result === 'won' ? colors.success
    : result === 'lost' ? colors['text-dim']
      : c.disputed ? colors.warn
        : colors.accent;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={live && day > 0 ? `DAY ${day} OF ${of}` : STATUS_LABEL[c.status]}
        title="FORGE DUEL"
        onBack={() => router.back()}
      />

      {/* ── THE RESULT, when there is one. Top of the page, said once. ── */}
      {result ? (
        <GlowCard glow={tint} testID="challenge-result">
          <Text
            allowFontScaling={false}
            style={{ fontSize: 22, color: tint, letterSpacing: 1, ...pixelFont() }}
          >
            {result === 'won' ? 'YOU WON' : result === 'drew' ? 'A DRAW' : `${theirName.toUpperCase()} WON`}
          </Text>
          <Text className="mt-s1 text-sm text-text-dim">
            {result === 'drew'
              ? `You both finished on ${sideLabel(c, me)}. Both stakes were refunded in full — a draw costs nobody anything.`
              : result === 'won'
                ? `You finished ${sideLabel(c, me)} against ${sideLabel(c, them)}. The escrow is yours.`
                : `${theirName} finished ${sideLabel(c, them)} against your ${sideLabel(c, me)}. Your stake went to them — the training still counted.`}
          </Text>
          <View className="mt-s3 flex-row items-center" style={{ gap: 6 }}>
            <CoinIcon size={16} />
            <Text className="text-sm" style={{ color: result === 'lost' ? colors['text-dim'] : colors.legendary }}>
              {result === 'won' ? `+${c.stake * 2} coins` : result === 'drew' ? `${c.stake} coins refunded` : `−${c.stake} coins`}
            </Text>
          </View>
        </GlowCard>
      ) : null}

      {/* ── THE COMPARISON ── */}
      <GlowCard testID="challenge-compare">
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.4 }}>
          {info.name}
        </Text>
        <View className="mt-s3" style={{ gap: 14 }}>
          <Competitor
            name={myName}
            label="YOU"
            value={sideLabel(c, me)}
            baseline={c.challenge_type === 'most_improved_lift'
              ? (c.i_am_challenger ? c.challenger_baseline : c.opponent_baseline) : null}
            current={c.i_am_challenger ? c.challenger_current?.value ?? null : c.opponent_current?.value ?? null}
            unit={info.unit}
            lead={leader === me}
            type={c.challenge_type}
            testID="challenge-me"
          />
          <Competitor
            name={theirName}
            label="OPPONENT"
            value={sideLabel(c, them)}
            baseline={c.challenge_type === 'most_improved_lift'
              ? (c.i_am_challenger ? c.opponent_baseline : c.challenger_baseline) : null}
            current={c.i_am_challenger ? c.opponent_current?.value ?? null : c.challenger_current?.value ?? null}
            unit={info.unit}
            lead={leader === them}
            type={c.challenge_type}
            testID="challenge-them"
          />
        </View>

        {live || result ? (
          <Text className="mt-s3 text-sm" style={{ color: tint }} testID="challenge-leader">
            {leader === 'tied'
              ? 'Dead level.'
              : leader === me
                ? `You lead by ${gap}${c.challenge_type === 'most_improved_lift' ? '%' : ` ${info.unit}`}.`
                : `${theirName} leads by ${gap}${c.challenge_type === 'most_improved_lift' ? '%' : ` ${info.unit}`}.`}
          </Text>
        ) : null}

        {live ? (
          <View className="mt-s3">
            <View className="overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
              <View
                style={{
                  width: `${challengeProgress(c, todayIso) * 100}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <Text className="mt-s1 text-2xs text-text-mute">
              Day {day} of {of}
              {day === of ? ' — final day.' : ''}
            </Text>
          </View>
        ) : null}
      </GlowCard>

      {/* ── THE ESCROW ── */}
      <GlowCard testID="challenge-escrow">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <CoinIcon size={20} />
            <View>
              <Text className="text-sm text-text">{c.stake} coins each</Text>
              <Text className="text-2xs text-text-mute">
                {c.status === 'pending'
                  ? 'Nothing is staked until it is accepted.'
                  : c.status === 'settled'
                    ? 'Settled.'
                    : `${c.stake * 2} coins held in escrow.`}
              </Text>
            </View>
          </View>
        </View>
      </GlowCard>

      {c.disputed ? (
        <GlowCard glow={colors.warn} testID="challenge-disputed">
          <Text className="text-sm" style={{ color: colors.warn }}>Settlement is paused.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            A dispute is open on this challenge. The coins stay in escrow — nobody is paid and
            nobody loses their stake — until it is reviewed.
          </Text>
        </GlowCard>
      ) : null}

      {/* ── WHAT TO DO ── */}
      {incoming && !expired ? (
        <>
          <SectionLabel>YOUR MOVE</SectionLabel>
          <GlowCard>
            <Text className="text-sm text-text">
              {theirName} has challenged you to {info.name.toLowerCase()} over {c.duration_days} days
              for {c.stake} coins.
            </Text>
            <Text className="mt-s2 text-2xs text-text-dim">{info.winner}</Text>
            <Text className="mt-s2 text-2xs text-text-mute">{SAFETY_NOTE}</Text>
          </GlowCard>
          <NeonButton
            title={accept.isPending ? 'ACCEPTING…' : `ACCEPT · STAKE ${c.stake} COINS`}
            size="hero"
            pixel
            busy={accept.isPending}
            onPress={() => accept.mutate(c.id)}
            testID="challenge-accept"
          />
          <NeonButton
            title="DECLINE"
            variant="ghost"
            pixel
            onPress={() => decline.mutate(c.id, { onSuccess: () => router.replace('/challenges' as never) })}
            testID="challenge-decline"
          />
        </>
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
        <>
          <SectionLabel>SENT</SectionLabel>
          <GlowCard>
            <Text className="text-sm text-text-dim">
              Waiting for {theirName} to accept. No coins have moved.
            </Text>
          </GlowCard>
          <NeonButton
            title="WITHDRAW CHALLENGE"
            variant="ghost"
            pixel
            onPress={() => cancel.mutate(c.id, { onSuccess: () => router.replace('/challenges' as never) })}
            testID="challenge-withdraw"
          />
        </>
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
          {settleable ? (
            <NeonButton
              title={settle.isPending ? 'SETTLING…' : 'SETTLE THIS CHALLENGE'}
              pixel
              busy={settle.isPending}
              onPress={() => settle.mutate(c.id)}
              testID="challenge-settle"
            />
          ) : null}
        </>
      ) : null}

      {result ? (
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
                durationDays: c.duration_days as ChallengeDuration,
                stake: c.stake as ChallengeStake,
                rematchOf: c.id,
              },
              { onSuccess: () => router.replace('/challenges' as never) }
            )
          }
          testID="challenge-rematch"
        />
      ) : null}

      {/* ── THE RULES, always reachable, never in the way ── */}
      <Pressable
        onPress={() => setShowRules((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showRules }}
        accessibilityLabel={showRules ? 'Hide the challenge rules' : 'View the challenge rules'}
        testID="challenge-view-rules"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text className="text-2xs" style={{ color: colors.accent, letterSpacing: 0.8 }}>
          {showRules ? 'HIDE RULES ›' : 'VIEW CHALLENGE RULES ›'}
        </Text>
      </Pressable>
      {showRules ? (
        <GlowCard testID="challenge-rules-body">
          <Rule k="MEASURED" v={info.measures} />
          <Rule k="WINNER" v={info.winner} />
          <Rule k="COUNTS" v={info.counts.join(' · ')} />
          <Rule k="DOES NOT COUNT" v={info.doesNotCount.join(' · ')} />
          <Rule k="A DRAW" v="Refunds both stakes in full." />
          <Rule k="CANCELLING" v="Refunds both stakes in full." />
          <Rule k="RULES" v="Locked when the challenge was accepted and cannot be changed." />
          <Text className="mt-s3 text-2xs text-text-mute">{SAFETY_NOTE}</Text>
        </GlowCard>
      ) : null}

      {/* ── DISPUTE ── */}
      {live || result ? (
        <>
          <Pressable
            onPress={() => setDisputeOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Report a problem with this challenge"
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
    </ScreenShell>
  );
}

/** One side's champion card: name, headline number, and the numbers behind it. */
function Competitor({
  name,
  label,
  value,
  baseline,
  current,
  unit,
  lead,
  type,
  testID,
}: {
  name: string;
  label: string;
  value: string;
  baseline: number | null;
  current: number | null;
  unit: string;
  lead: boolean;
  type: string;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border p-s3"
      style={{
        borderColor: lead ? `${colors.accent}70` : colors.border,
        backgroundColor: lead ? 'rgba(34,211,238,0.06)' : 'rgba(13,21,36,0.4)',
      }}
      testID={testID}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1.4, ...pixelFont(false) }}>
          {label}
        </Text>
        {lead ? (
          <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1.2, color: colors.accent, ...pixelFont(false) }}>
            LEADING
          </Text>
        ) : null}
      </View>
      <Text className="mt-s1 text-sm text-text" numberOfLines={1}>{name}</Text>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 30, color: lead ? colors.accent : colors.text, letterSpacing: 0, ...pixelFont() }}
      >
        {value}
      </Text>
      {/* The numbers BEHIND the headline, so a percentage is never something
          the athlete has to take on trust. */}
      {type === 'most_improved_lift' && baseline !== null ? (
        <Text className="text-2xs text-text-mute">
          {baseline > 0 ? `${baseline} → ${current ?? 0} ${unit}` : `no starting lift logged · ${current ?? 0} ${unit}`}
        </Text>
      ) : null}
    </View>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <View className="mt-s2">
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.2 }}>{k}</Text>
      <Text className="mt-s1 text-2xs text-text-dim">{v}</Text>
    </View>
  );
}
