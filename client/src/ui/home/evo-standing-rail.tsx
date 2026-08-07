import { useEffect, useState } from 'react';
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

import { useEvoSnapshots } from '@/data/progression/use-evo-rating';
import { useLeaderboardByMetric, usePublicIdentity } from '@/data/hooks';
import { ratingChange, standingLine, standingOf } from '@/domain/evo-standing';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * AM I MOVING? — one line under the Evo crest.
 *
 * The rating says what you are. This says whether it is going anywhere, which
 * is the thing that actually brings someone back tomorrow. Movement outranks
 * position deliberately: "+4 this week" acts on behaviour, "#2" does not.
 *
 * IT SAYS NOTHING RATHER THAN SOMETHING VAGUE. A brand-new athlete has no week
 * to report and a private athlete has no board position, and both get an empty
 * rail instead of "+0" or "top 100%". The whole point of putting a number on
 * the first screen is that the athlete believes it.
 *
 * The clock is read once on MOUNT, never during render: a clock-derived value
 * in a statically prerendered tree is the React #418 hydration mismatch this
 * app has already paid for once. Safe here because the rail renders null until
 * its queries resolve, so the prerender and the first client render agree.
 */
export function EvoStandingRail({ width }: { width?: number }) {
  const colors = useThemeColors();
  // Read ONCE on mount, never during render. It is only ever consumed after
  // the snapshot query resolves, so the prerendered tree and the first client
  // render both produce null and there is nothing to mismatch on.
  const [nowMs] = useState(() => Date.now());
  const reduced = useReducedMotion();
  const snapshots = useEvoSnapshots(26);
  const board = useLeaderboardByMetric('evo', 100);
  const identity = usePublicIdentity();

  const change = ratingChange(snapshots.data ?? [], nowMs);
  const standing = standingOf(board.data ?? [], identity.data?.displayName ?? null);
  const line = standingLine(change, standing);

  // A GAIN GETS ONE BREATH, then rests. A permanently pulsing number is
  // wallpaper; a single swell the moment it is read is a reward.
  const glow = useSharedValue(0);
  useEffect(() => {
    if (reduced || change === null || change <= 0) {
      glow.value = 0;
      return;
    }
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.25, { duration: 1600, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
  }, [reduced, change, glow]);

  const style = useAnimatedStyle(() => ({ opacity: reduced ? 1 : 0.7 + glow.value * 0.3 }));

  if (line === null) return null;

  const climbing = change !== null && change > 0;
  const tint = climbing ? colors.success : standing?.position === 1 ? colors.legendary : colors['text-mute'];

  return (
    <Animated.View style={[{ marginTop: 6, width, alignItems: 'center' }, style]}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        testID="evo-standing"
        accessibilityLabel={
          climbing
            ? `Your Evo Rating is up ${change} this week.`
            : standing
              ? `You are ranked ${standing.position} of ${standing.total} rated athletes.`
              : line
        }
        style={{ fontSize: 10, letterSpacing: 1.6, color: tint, ...pixelFont(false) }}
      >
        {climbing ? '▲ ' : ''}
        {line}
      </Text>
      {/* The chase, only when there IS someone to chase and a real gap. */}
      {standing && standing.chasingRating !== null && standing.chasingName ? (
        <Text
          className="mt-s1 text-2xs text-text-mute"
          numberOfLines={1}
          style={{ letterSpacing: 0.4 }}
          testID="evo-chasing"
        >
          {standing.chasingName} leads on {standing.chasingRating}
        </Text>
      ) : null}
    </Animated.View>
  );
}
