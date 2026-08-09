import { Pressable, Text, View } from 'react-native';

import { useCallOffCallout, useMyCallouts, useRespondCallout, useVerifyCallout } from '@/data/callouts';
import {
  calloutHeadline,
  calloutOutcomeCoins,
  calloutResultLine,
  isLive,
  type CalloutRow,
} from '@/domain/callouts';
import { chipPile } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ForgeChipStack } from '@/ui/duel/forge-chip';

/**
 * CALL OUTS, on the hub.
 *
 * The floating layer in Train is where a call out is ANSWERED in the moment;
 * this is where one waits. An athlete who dismissed a card mid-set, or who was
 * away from their phone, comes here — and every notification about a call out
 * deep-links here, because it is the one destination that is always valid (a
 * workout page needs a live date and a plan in its URL).
 *
 * Static chips only. A hub that ran a physics world per row would be the exact
 * thing §42 forbids.
 */
export function CalloutList() {
  const colors = useThemeColors();
  const { data } = useMyCallouts();
  const rows = (data ?? []).filter((c) => isLive(c.status) || c.status === 'settled');
  if (rows.length === 0) return null;

  return (
    <View className="gap-s2" testID="callout-list">
      <Text
        allowFontScaling={false}
        className="text-text-mute"
        style={{ fontSize: 9, letterSpacing: 1.8 }}
      >
        CALL OUTS
      </Text>
      {rows.slice(0, 6).map((c) => (
        <Row key={c.id} callout={c} />
      ))}
      <Text className="text-2xs text-text-mute">
        A call out attaches to one set. Start one from the ◉ on an exercise while you train.
      </Text>
      <View style={{ height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

function Row({ callout }: { callout: CalloutRow }) {
  const colors = useThemeColors();
  const respond = useRespondCallout();
  const verify = useVerifyCallout();
  const callOff = useCallOffCallout();

  const settled = callout.status === 'settled';
  const coins = calloutOutcomeCoins(callout);
  const mustAnswer = callout.status === 'offered' && !callout.i_am_athlete;
  const mustVerify = callout.status === 'awaiting_verification' && !callout.i_am_athlete;
  const disputed = callout.status === 'disputed';
  const tint = disputed
    ? colors.danger
    : settled
      ? coins > 0
        ? colors.legendary
        : colors['text-dim']
      : colors.legendary;

  return (
    <View
      className="rounded-xl border p-s3"
      style={{ borderColor: `${tint}45`, backgroundColor: 'rgba(13,21,36,0.55)', gap: 4 }}
      testID={`callout-row-${callout.id}`}
    >
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-text-mute"
          style={{ fontSize: 8, letterSpacing: 1.5, flex: 1 }}
          numberOfLines={1}
        >
          {calloutHeadline(callout)}
        </Text>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <ForgeChipStack chips={chipPile(settled ? callout.pot : callout.stake, 4)} size={12} />
          <Text allowFontScaling={false} style={{ fontSize: 13, color: tint, ...pixelFont() }}>
            {settled ? (coins > 0 ? `+${coins}` : `${coins}`) : callout.pot}
          </Text>
        </View>
      </View>

      <Text className="text-2xs font-bold text-text-dim" numberOfLines={1}>
        {callout.exercise.toUpperCase()} · {callout.target_label}
      </Text>
      {settled || callout.actual_reps != null ? (
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {calloutResultLine(callout) ?? ''}
        </Text>
      ) : null}
      {disputed ? (
        <Text className="text-2xs text-text-mute">
          Frozen. Nobody is paid until you both call it off, or it times out and both pledges return.
        </Text>
      ) : null}

      {mustAnswer ? (
        <View className="mt-s1 flex-row" style={{ gap: 8 }}>
          <Action
            label={`PUSH ${callout.stake}`}
            onPress={() => respond.mutate({ id: callout.id, accept: true })}
            busy={respond.isPending}
            filled
            testID={`callout-row-doubt-${callout.id}`}
          />
          <Action
            label="PASS"
            onPress={() => respond.mutate({ id: callout.id, accept: false })}
            busy={respond.isPending}
            testID={`callout-row-pass-${callout.id}`}
          />
        </View>
      ) : mustVerify ? (
        <View className="mt-s1 flex-row" style={{ gap: 8 }}>
          <Action
            label="✓ VERIFY"
            onPress={() => verify.mutate({ id: callout.id, verdict: 'verify' })}
            busy={verify.isPending}
            filled
            testID={`callout-row-verify-${callout.id}`}
          />
          <Action
            label="DIDN'T SEE"
            onPress={() => verify.mutate({ id: callout.id, verdict: 'dispute', reason: 'Did not see it' })}
            busy={verify.isPending}
            testID={`callout-row-dispute-${callout.id}`}
          />
        </View>
      ) : callout.status === 'accepted' || disputed ? (
        <View className="mt-s1 flex-row" style={{ gap: 8 }}>
          <Action
            label={
              (callout.i_am_athlete ? callout.athlete_calloff_at : callout.opponent_calloff_at)
                ? 'WAITING ON THEM'
                : 'CALL IT OFF'
            }
            onPress={() => callOff.mutate(callout.id)}
            busy={callOff.isPending}
            testID={`callout-row-calloff-${callout.id}`}
          />
        </View>
      ) : null}
    </View>
  );
}

function Action({
  label,
  onPress,
  busy,
  filled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  filled?: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      className="flex-1 items-center justify-center rounded-lg border"
      style={{
        minHeight: 44,
        borderColor: filled ? colors.legendary : colors.border,
        backgroundColor: filled ? colors.legendary : 'transparent',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 12, color: filled ? '#04121a' : colors['text-dim'], ...pixelFont() }}
      >
        {busy ? '…' : label}
      </Text>
    </Pressable>
  );
}
