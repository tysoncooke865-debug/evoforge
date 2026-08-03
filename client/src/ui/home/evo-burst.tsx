/**
 * HOME (PREMIUM PASS, 2026-08-03) — the Evo Rating's celebration burst.
 *
 * The brief: "tiny particle burst when rating increases". The rating is the
 * product, and until now it changed SILENTLY — an athlete who trained for six
 * weeks to go from 51 to 52 got a different numeral and nothing else. This is
 * the moment that was missing.
 *
 * IT FIRES ON A REAL EVENT ONLY. The caller compares the live
 * `displayed_rating` against the last one this DEVICE saw (a single
 * AsyncStorage integer) and bumps `fire` when it has genuinely gone up. A
 * first-ever reading writes the baseline and celebrates nothing — there is no
 * achievement in arriving.
 *
 * ONE SHARED VALUE, TWELVE SHARDS. Each shard derives its own trajectory from
 * the same 0→1 clock inside its worklet, so the whole burst costs one
 * animation driver, not twelve. Pixel SQUARES, not circles — this is a pixel
 * game, and a round particle reads as a different app's confetti.
 *
 * NOT gated on perf mode or focus: it is a ONE-SHOT that ends at opacity 0
 * (the animations.ts doctrine — never disable one-shots, they are the reward).
 * Reduced motion IS honoured, because an unrequested burst of movement is
 * exactly what that setting is for; those athletes still get the toast, the
 * haptic and the number.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const SHARDS = 12;
const DURATION = 900;

export function EvoBurst({ fire, colour, radius }: { fire: number; colour: string; radius: number }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (fire === 0 || reduced) return;
    t.value = 0;
    t.value = withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fire, reduced]);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: SHARDS }, (_, i) => (
        <Shard key={i} index={i} t={t} colour={colour} radius={radius} />
      ))}
    </View>
  );
}

function Shard({
  index,
  t,
  colour,
  radius,
}: {
  index: number;
  t: { value: number };
  colour: string;
  radius: number;
}) {
  // Deterministic scatter: the angle is evenly spaced with a fixed per-index
  // wobble, and the distance alternates — no Math.random(), which would make
  // the burst impossible to reproduce in a tour screenshot.
  const angle = (index / SHARDS) * Math.PI * 2 + (index % 3) * 0.21;
  const reach = radius * (index % 2 === 0 ? 1 : 0.68);
  const size = index % 3 === 0 ? 4 : 3;

  const style = useAnimatedStyle(() => {
    const p = t.value;
    return {
      opacity: p === 0 ? 0 : 1 - p,
      transform: [
        { translateX: Math.cos(angle) * reach * p },
        // A touch of lift: shards drift up as they fade, like sparks.
        { translateY: Math.sin(angle) * reach * p - p * 10 },
        { scale: 1 - p * 0.45 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.9,
          shadowRadius: 5,
        },
        style,
      ]}
    />
  );
}
