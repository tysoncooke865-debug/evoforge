import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  CHALLENGE_INFO,
  STATUS_LABEL,
  challengeDay,
  leaderOf,
  myResult,
  sideLabel,
  sidesOf,
  type ForgeChallenge,
} from '@/domain/forge-challenge';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';

/**
 * ONE CHALLENGE, compactly. The hub is a list of these; the detail screen is
 * the same information with room to breathe.
 *
 * Deliberately a STATIC card — no combat, no animation frames. The brief's
 * language: champion cards, progress bars, training statistics. What moves is
 * the progress rail and the numbers, because those are the things that
 * actually changed.
 */
export function ChallengeCard({
  challenge,
  myId,
  todayIso,
  testID,
}: {
  challenge: ForgeChallenge;
  myId: string;
  todayIso: string;
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

  // Colour follows the OUTCOME, and a draw is neutral — never the red of a
  // loss. Losing a friendly wager should not look like a failure state.
  const tint =
    result === 'won' ? colors.success
      : result === 'lost' ? colors['text-dim']
        : c.status === 'disputed' ? colors.warn
          : live ? colors.accent
            : colors['text-mute'];

  return (
    <Pressable
      onPress={() => router.push(`/challenges/${c.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${info.name} against ${theirName}. ${STATUS_LABEL[c.status]}.`}
      testID={testID ?? `challenge-card-${c.id}`}
      className="w-full rounded-xl border p-s3"
      style={{ borderColor: `${tint}45`, backgroundColor: 'rgba(13,21,36,0.55)', minHeight: 44 }}
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

      <Text className="mt-s1 text-sm text-text" numberOfLines={1}>
        vs {theirName}
      </Text>

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
            {c.stake} each · {c.stake * 2} escrowed
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
