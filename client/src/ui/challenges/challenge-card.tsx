import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  CHALLENGE_INFO,
  STATUS_LABEL,
  challengeDay,
  leaderOf,
  myEscrow,
  myResult,
  potOf,
  settledPot,
  sideLabel,
  sidesOf,
  type ForgeChallenge,
} from '@/domain/forge-challenge';
import { countdown, formatCoins } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';

/**
 * ONE DUEL, compactly. The hub is a list of these; the detail screen is the
 * same information with room to breathe.
 *
 * WHAT A CARD MUST ANSWER IN ONE GLANCE: who, who is ahead, how much is on the
 * table, how long is left, and whether it needs me. The last one is why the
 * OFFER badge exists and why it is the loudest thing on the card — a raise
 * waiting on an answer is the only state where the athlete is blocking the
 * duel rather than the other way round.
 */
export function ChallengeCard({
  challenge,
  myId,
  todayIso,
  nowMs,
  testID,
}: {
  challenge: ForgeChallenge;
  myId: string;
  todayIso: string;
  /** The hub's clock, passed in. A `Date.now()` default would be an impure
   *  read during render, and a list of twenty cards each reading their own
   *  clock is twenty slightly different answers to the same question. */
  nowMs: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const c = challenge;
  const info = CHALLENGE_INFO[c.challenge_type];
  const { me, them, myName, theirName } = sidesOf(c);
  const leader = leaderOf(c);
  const result = myResult(c, myId);
  const { day, of } = challengeDay(c, todayIso);
  const live = c.status === 'active' || c.status === 'awaiting_settlement';
  const offer = c.pending_offer;
  const needsMe = Boolean(offer && !offer.mine && live);
  const pot = result ? settledPot(c) : potOf(c);
  const left = c.ends_at ? Date.parse(c.ends_at) - nowMs : 0;

  // Colour follows the OUTCOME, and a draw is neutral — never the red of a
  // loss. Losing a friendly wager should not look like a failure state.
  const tint =
    needsMe ? colors.legendary
      : result === 'won' ? colors.success
        : result === 'lost' ? colors['text-dim']
          : c.status === 'disputed' ? colors.warn
            : live ? colors.accent
              : colors['text-mute'];

  return (
    <Pressable
      onPress={() => router.push(`/challenges/${c.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${info.name} against ${theirName}. ${
        needsMe ? 'They want to raise the stakes.' : STATUS_LABEL[c.status]
      }`}
      testID={testID ?? `challenge-card-${c.id}`}
      className="w-full rounded-xl border p-s3"
      style={{
        borderColor: needsMe ? `${tint}8c` : `${tint}45`,
        backgroundColor: needsMe ? 'rgba(251,191,36,0.07)' : 'rgba(13,21,36,0.55)',
        minHeight: 44,
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 9, letterSpacing: 1.4, color: tint, ...pixelFont(false) }}
        >
          {info.name}
        </Text>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
        >
          {live && day > 0 ? `DAY ${day} OF ${of}` : STATUS_LABEL[c.status]}
        </Text>
      </View>

      <View className="mt-s1 flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="text-sm text-text" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          vs {theirName}
        </Text>
        {live && left > 0 ? (
          <Text
            allowFontScaling={false}
            style={{ fontSize: 11, color: colors['text-dim'], letterSpacing: 0, ...pixelFont() }}
          >
            {countdown(left)}
          </Text>
        ) : null}
      </View>

      {/* BOTH SIDES, side by side. A wager the athlete has to compute is not a
          comparison — it is homework. */}
      <View className="mt-s2 flex-row" style={{ gap: 12 }}>
        <Side
          name={myName}
          value={sideLabel(c, me)}
          lead={leader === me}
          dim={result === 'lost'}
          testID={`challenge-${c.id}-mine`}
        />
        <Side
          name={theirName}
          value={sideLabel(c, them)}
          lead={leader === them}
          dim={result === 'won'}
          testID={`challenge-${c.id}-theirs`}
        />
      </View>

      <View className="mt-s2 flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <CoinIcon size={13} />
          <Text className="text-2xs text-text-mute">
            {c.status === 'pending'
              ? `${formatCoins(c.stake)} each · nothing locked yet`
              : `POT ${formatCoins(pot)} · ${formatCoins(myEscrow(c, myId))} yours`}
          </Text>
        </View>
        {result ? (
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.2, color: tint, ...pixelFont(false) }}
          >
            {result === 'won' ? 'YOU WON' : result === 'drew' ? 'DRAW · REFUNDED' : 'THEY WON'}
          </Text>
        ) : leader !== 'tied' && live ? (
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.2, color: tint, ...pixelFont(false) }}
          >
            {leader === me ? 'YOU LEAD' : `${theirName.toUpperCase()} LEADS`}
          </Text>
        ) : null}
      </View>

      {needsMe && offer ? (
        <View
          className="mt-s2 flex-row items-center rounded-md border px-s2 py-s1"
          style={{ gap: 6, borderColor: `${colors.legendary}66`, backgroundColor: 'rgba(251,191,36,0.09)' }}
          testID={`challenge-${c.id}-offer`}
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.2, color: colors.legendary, ...pixelFont(false) }}
          >
            {offer.kind === 'all_in' ? 'ALL IN OFFER' : 'RAISE OFFER'}
          </Text>
          <Text className="text-2xs text-text-dim" numberOfLines={1} style={{ flex: 1 }}>
            +{formatCoins(offer.amount)} each → pot {formatCoins(offer.pot_if_accepted)}
          </Text>
          <Text className="text-2xs" style={{ color: colors.legendary }}>›</Text>
        </View>
      ) : null}

      {offer?.mine && live ? (
        <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
          Your {offer.kind === 'all_in' ? 'all-in' : 'raise'} is waiting on {theirName}.
        </Text>
      ) : null}

      {c.supporter_count > 0 && live ? (
        <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
          {c.supporter_count} {c.supporter_count === 1 ? 'friend is' : 'friends are'} backing this duel.
        </Text>
      ) : null}

      {c.disputed ? (
        <Text className="mt-s1 text-2xs" style={{ color: colors.warn }}>
          Paused — a dispute is open. The coins stay in escrow until it is reviewed.
        </Text>
      ) : null}
    </Pressable>
  );
}

function Side({
  name,
  value,
  lead,
  dim,
  testID,
}: {
  name: string;
  value: string;
  lead: boolean;
  dim: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, minWidth: 0, opacity: dim ? 0.55 : 1 }} testID={testID}>
      <Text className="text-text-mute" numberOfLines={1} style={{ fontSize: 10 }}>
        {name}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{
          fontSize: 18,
          letterSpacing: 0,
          color: lead ? colors.accent : colors.text,
          ...pixelFont(),
        }}
      >
        {value}
      </Text>
    </View>
  );
}
