import { Pressable, Text, View } from 'react-native';

import { useCallOffCallout, useCancelCallout } from '@/data/callouts';
import { chipPile } from '@/domain/forge-duel';
import { useState } from 'react';
import { type CalloutRow } from '@/domain/callouts';
import { PoolOpenSheet } from './pool-open';
import { useThemeColors } from '@/theme/use-theme';
import { ForgeChipStack } from '@/ui/duel/forge-chip';

/**
 * THE STRIP ON A CALLED SET.
 *
 * §18: once a call out is live it must NOT keep a physics scene open. This is a
 * badge — a static `ForgeChipStack`, a number and four words — and it is the
 * only thing the workout page renders for a live wager. It creates tension
 * without distorting the layout, and a set row with no call out renders nothing
 * at all.
 *
 * The chips are `chipPile`, which stacks ONE denomination so the height tracks
 * the money. That is the same picture the duel's pot draws, drawn small.
 */
export function CalloutBadge({ callout, unit }: { callout: CalloutRow; unit?: string }) {
  const colors = useThemeColors();
  const cancel = useCancelCallout();
  const callOff = useCallOffCallout();
  const [asking, setAsking] = useState(false);
  void unit;

  const offered = callout.status === 'offered';
  const awaiting = callout.status === 'awaiting_verification';
  const other = (callout.i_am_athlete ? callout.opponent_name : callout.athlete_name).toUpperCase();

  // Offered money is not in the pot yet: show the stake. Once doubted, the POT
  // is the number — that is what changed, and it is what the athlete is lifting
  // against.
  const shown = offered ? callout.stake : callout.pot;
  const tint = offered ? colors['text-dim'] : colors.legendary;

  return (
    <View
      className="mb-s1 flex-row items-center rounded-lg border px-s2 py-s1"
      style={{
        gap: 8,
        borderColor: offered ? colors.border : `${colors.legendary}59`,
        backgroundColor: offered ? 'rgba(13,21,36,0.5)' : 'rgba(251,191,36,0.07)',
      }}
      testID={`callout-badge-${callout.set_no}`}
    >
      <ForgeChipStack chips={chipPile(shown, 5)} size={13} />
      <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: tint }}>
        {shown}
      </Text>
      <Text
        allowFontScaling={false}
        className="text-2xs text-text-mute"
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0 }}
      >
        {offered
          ? `OFFERED · ${other}`
          : awaiting
            ? `AWAITING ${other}`
            : `POOL · ${callout.target_label}`}
      </Text>

      {/* ASK FRIENDS (180-185). The athlete's own set only, and only while it is
          still ahead of them — once it is logged, joining would be backing a
          result somebody can already read.

          THIS IS THE ONLY WAY AN INVITATION IS EVER ISSUED. There is no browsable
          list of open pools anywhere, so if this control is absent nobody outside
          the two principals can put a coin on this set. */}
      {callout.i_am_athlete && (offered || callout.status === 'accepted') ? (
        <Pressable
          onPress={() => setAsking(true)}
          accessibilityRole="button"
          accessibilityLabel="Ask friends to take a side on this set"
          testID={`callout-ask-friends-${callout.set_no}`}
          style={{ minWidth: 44, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <Text allowFontScaling={false} className="text-2xs" style={{ color: colors.accent }}>
            {(callout.joiners ?? 0) > 0 ? `+${callout.joiners}` : '+'}
          </Text>
        </Pressable>
      ) : null}
      {asking ? (
        <PoolOpenSheet
          calloutId={callout.id}
          exercise={callout.exercise}
          targetLabel={callout.target_label}
          stake={callout.stake}
          backTotal={callout.back_total ?? callout.stake}
          pushTotal={callout.push_total ?? callout.stake}
          joiners={callout.joiners ?? 0}
          alreadyOpen={callout.mode === 'pot'}
          onClose={() => setAsking(false)}
        />
      ) : null}

      {/* THE UNDO IS PERSISTENT, NOT A FIVE-SECOND WINDOW.
          An offer nobody has answered can be withdrawn for as long as it stands,
          which is strictly kinder than a countdown and has no timing to get
          wrong. Once it has been DOUBTED, calling it off needs both signatures —
          a wager one side can walk out of is not a wager. */}
      {offered ? (
        <Pressable
          onPress={() => cancel.mutate(callout.id)}
          accessibilityRole="button"
          accessibilityLabel="Withdraw this call out"
          testID={`callout-withdraw-${callout.set_no}`}
          style={{ minWidth: 44, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <Text allowFontScaling={false} className="text-2xs text-text-mute">✕</Text>
        </Pressable>
      ) : callout.status === 'accepted' ? (
        <Pressable
          onPress={() => callOff.mutate(callout.id)}
          accessibilityRole="button"
          accessibilityLabel="Ask to call this off"
          testID={`callout-calloff-${callout.set_no}`}
          style={{ minHeight: 32, justifyContent: 'center' }}
        >
          <Text allowFontScaling={false} className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            {callout.i_am_athlete
              ? callout.athlete_calloff_at
                ? 'ASKED'
                : 'CALL OFF'
              : callout.opponent_calloff_at
                ? 'ASKED'
                : 'CALL OFF'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
