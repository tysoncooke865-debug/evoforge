import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { Confidence } from '@/domain/challenge-progression';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE SCORELINE, AS A PICTURE.
 *
 * Two bars normalised to whoever is ahead, so the leader's rail is always full
 * and the gap is the shape of the difference rather than a number to subtract.
 * With nothing logged on either side both are empty, which is the honest
 * picture: nobody has done anything yet.
 */
export function ScoreBar({
  fill,
  tint,
  lead,
  testID,
}: {
  /** 0..1, already normalised against the other side. */
  fill: number;
  tint: string;
  lead: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const w = useSharedValue(reduced ? fill : 0);
  useEffect(() => {
    w.value = reduced ? fill : withTiming(fill, { duration: 620, easing: Easing.out(Easing.cubic) });
  }, [fill, reduced, w]);
  const style = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, w.value)) * 100}%` }));
  return (
    <View
      testID={testID}
      className="mt-s1 w-full overflow-hidden rounded-pill"
      style={{ height: 6, backgroundColor: colors['surface-3'] }}
    >
      <Animated.View
        style={[
          { height: '100%', borderRadius: 999, backgroundColor: tint, opacity: lead ? 1 : 0.55 },
          style,
        ]}
      />
    </View>
  );
}

/**
 * THE LEAD STRIP — one line that says how it stands and by how much.
 *
 * THE BAND IS NEVER A PERCENTAGE-TO-WIN. A contest decided by future training
 * has no honest probability, and a fake one deserves to be disbelieved (139's
 * rule, kept). What IS honest is the CURRENT gap, so the band's words carry the
 * feeling and the number beside them carries the fact.
 *
 * A LEAD CHANGE IS THE ONE EVENT THIS SCREEN INTERRUPTS FOR. It fires only when
 * the leader changes while the strip is already mounted — never on first paint,
 * which would announce old news to somebody who just opened the page.
 */
export function LeadStrip({
  confidence,
  gapLabel,
  leaderId,
  myId,
  live,
  testID,
}: {
  confidence: Confidence;
  /** The numeric gap, already formatted with its unit ("+2.3%", "2 days"). */
  gapLabel: string | null;
  leaderId: string | null;
  myId: string;
  live: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const [flash, setFlash] = useState(false);
  const seen = useRef<string | null | undefined>(undefined);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = leaderId; // first paint is not news
      return;
    }
    if (seen.current === leaderId || !live) {
      seen.current = leaderId;
      return;
    }
    seen.current = leaderId;
    // Written from TIMER CALLBACKS, never synchronously in the effect body —
    // the same rule ui/core/count-up.ts follows. A synchronous setState here
    // is a cascading render on every score refresh.
    const on = setTimeout(() => setFlash(true), 0);
    const off = setTimeout(() => setFlash(false), 2600);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [leaderId, live]);

  useEffect(() => {
    if (!flash || reduced) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 420 }), withTiming(0, { duration: 420 })),
      -1
    );
  }, [flash, reduced, pulse]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.value * 0.45 }));

  const leading = confidence.band === 'commanding' || confidence.band === 'ahead';
  const losing = confidence.band === 'chasing' || confidence.band === 'behind';
  const tint = leading ? colors.success : losing ? colors.warn : colors['text-dim'];

  if (flash) {
    const mine = leaderId === myId;
    return (
      <Animated.View
        testID={testID}
        style={[
          {
            marginTop: 12,
            alignItems: 'center',
            borderRadius: 12,
            borderWidth: 1,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderColor: mine ? `${colors.success}8c` : `${colors.danger}8c`,
            backgroundColor: mine ? 'rgba(52,211,153,0.12)' : 'rgba(251,113,133,0.1)',
          },
          flashStyle,
        ]}
        accessibilityLiveRegion="polite"
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 13,
            letterSpacing: 1.8,
            color: mine ? colors.success : colors.danger,
            ...pixelFont(),
          }}
        >
          {leaderId === null ? 'LEVEL AGAIN' : mine ? 'YOU TOOK THE LEAD' : 'LEAD LOST'}
        </Text>
      </Animated.View>
    );
  }

  // A FINISHED CONTEST IS NOT COACHED. "Hold it. One more session keeps this
  // out of reach" under a settled result is advice about a duel that is over,
  // and it makes the whole card read as boilerplate. Once it is done the strip
  // states the margin and stops talking.
  if (!live) {
    return (
      <View
        testID={testID}
        className="mt-s3 items-center rounded-lg border px-s3 py-s2"
        style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
      >
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.6, ...pixelFont(false) }}
          >
            {gapLabel ? 'FINAL MARGIN' : 'FINISHED LEVEL'}
          </Text>
          {gapLabel ? (
            <Text allowFontScaling={false} style={{ fontSize: 13, color: colors['text-dim'], letterSpacing: 0, ...pixelFont() }}>
              {gapLabel}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View
      testID={testID}
      className="mt-s3 items-center rounded-lg border px-s3 py-s2"
      style={{
        borderColor: leading ? `${colors.success}59` : losing ? `${colors.warn}59` : colors.border,
        backgroundColor: leading
          ? 'rgba(52,211,153,0.07)'
          : losing
            ? 'rgba(251,191,36,0.06)'
            : 'rgba(13,21,36,0.5)',
      }}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 11, letterSpacing: 1.6, color: tint, ...pixelFont(false) }}
        >
          {confidence.label}
        </Text>
        {gapLabel ? (
          <Text allowFontScaling={false} style={{ fontSize: 13, color: tint, letterSpacing: 0, ...pixelFont() }}>
            {gapLabel}
          </Text>
        ) : null}
      </View>
      <Text className="mt-s1 text-center text-2xs text-text-mute">{confidence.note}</Text>
    </View>
  );
}
