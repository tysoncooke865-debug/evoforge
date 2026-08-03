/**
 * HOME — the Evo Rating's pixel shards, in both directions.
 *
 * OUT (`fire`): the celebration. The rating is the product, and until this
 * existed it changed SILENTLY — an athlete who trained six weeks to go from
 * 51 to 52 got a different numeral and nothing else.
 *
 * IN (`converge`): the entrance. The brief asks for "digits materialise from
 * tiny pixels", so the same twelve shards run in reverse, arriving on the
 * numeral as it resolves. Same geometry, same cost, one component.
 *
 * ONE SHARED VALUE, TWELVE SHARDS. Each derives its own trajectory from the
 * same 0→1 clock inside its worklet, so a burst costs one animation driver,
 * not twelve. Pixel SQUARES, never circles — this is a pixel game, and a round
 * particle reads as another app's confetti.
 *
 * NOT gated on perf mode or focus: these are ONE-SHOTS that end at opacity 0
 * (the animations.ts doctrine — never disable one-shots, they are the reward).
 * Reduced motion IS honoured, because unrequested movement is exactly what
 * that setting is for; those athletes still get the toast, the haptic and the
 * number.
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
const OUT_MS = 900;
const IN_MS = 420;

export function EvoBurst({
  fire,
  colour,
  radius,
  converge = 0,
}: {
  /** Bump to play the outward celebration. */
  fire: number;
  colour: string;
  radius: number;
  /** Bump to play the inward materialise (the entrance). */
  converge?: number;
}) {
  const reduced = useReducedMotion();
  const out = useSharedValue(0);
  const inward = useSharedValue(0);

  useEffect(() => {
    if (fire === 0 || reduced) return;
    out.value = 0;
    out.value = withTiming(1, { duration: OUT_MS, easing: Easing.out(Easing.cubic) });
  }, [fire, reduced, out]);

  useEffect(() => {
    if (converge === 0 || reduced) return;
    inward.value = 0;
    inward.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.quad) });
  }, [converge, reduced, inward]);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: SHARDS }, (_, i) => (
        <Shard key={i} index={i} out={out} inward={inward} colour={colour} radius={radius} />
      ))}
    </View>
  );
}

function Shard({
  index,
  out,
  inward,
  colour,
  radius,
}: {
  index: number;
  out: { value: number };
  inward: { value: number };
  colour: string;
  radius: number;
}) {
  // Deterministic scatter: evenly spaced angles with a fixed per-index wobble,
  // alternating reach — no Math.random(), which would make the burst
  // impossible to reproduce in a tour screenshot.
  const angle = (index / SHARDS) * Math.PI * 2 + (index % 3) * 0.21;
  const reach = radius * (index % 2 === 0 ? 1 : 0.68);
  const size = index % 3 === 0 ? 4 : 3;

  const style = useAnimatedStyle(() => {
    // The inward run owns the node whenever it is mid-flight; otherwise the
    // outward one does. They can never overlap in practice (an entrance and a
    // level-up are 700ms apart at worst) and this keeps it to one node.
    const i = inward.value;
    if (i > 0 && i < 1) {
      const d = 1 - i; // 1 = far out, 0 = arrived on the glyph
      return {
        opacity: Math.min(1, i * 3) * (1 - i * 0.15),
        transform: [
          { translateX: Math.cos(angle) * reach * d },
          { translateY: Math.sin(angle) * reach * d },
          { scale: 0.6 + d * 0.5 },
        ],
      };
    }
    const p = out.value;
    return {
      opacity: p === 0 || p === 1 ? 0 : 1 - p,
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
