/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated in effects by design; see neon-button.tsx. */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useSettingsStore } from '@/state/settings-store';

/**
 * The animated pixel companion (Tyson's Cyber Athlete sheet, level 1).
 *
 * RENDERING CONTRACT, learned the hard way:
 *  - every frame stays MOUNTED (swapping one Image's source reloads it
 *    asynchronously on web and blanks the sprite between frames);
 *  - frame selection runs ON THE UI THREAD via a Reanimated clock — the
 *    first JS-timer version re-rendered React state up to 14×/s on every
 *    screen carrying a sprite, which broke first-tap presses on phones
 *    (buttons needed a double tap). Zero React re-renders per frame now.
 *
 * REMOVAL SWITCH: flip SPRITE_COMPANION_ENABLED to false and every
 * companion on every page disappears cleanly.
 */
export const SPRITE_COMPANION_ENABLED = true;

type Anim = 'idle' | 'run' | 'punch' | 'victory';

/* eslint-disable @typescript-eslint/no-require-imports */
const FRAMES: Record<Anim, number[]> = {
  idle: [
    require('../assets/avatars/sprites/idle_1.png'),
    require('../assets/avatars/sprites/idle_2.png'),
    require('../assets/avatars/sprites/idle_3.png'),
    require('../assets/avatars/sprites/idle_4.png'),
    require('../assets/avatars/sprites/idle_5.png'),
    require('../assets/avatars/sprites/idle_6.png'),
  ],
  run: [
    require('../assets/avatars/sprites/run_1.png'),
    require('../assets/avatars/sprites/run_2.png'),
    require('../assets/avatars/sprites/run_3.png'),
    require('../assets/avatars/sprites/run_4.png'),
    require('../assets/avatars/sprites/run_5.png'),
    require('../assets/avatars/sprites/run_6.png'),
    require('../assets/avatars/sprites/run_7.png'),
  ],
  punch: [
    require('../assets/avatars/sprites/punch_1.png'),
    require('../assets/avatars/sprites/punch_2.png'),
    require('../assets/avatars/sprites/punch_3.png'),
  ],
  victory: [
    require('../assets/avatars/sprites/victory_1.png'),
    require('../assets/avatars/sprites/victory_2.png'),
    require('../assets/avatars/sprites/victory_3.png'),
  ],
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Canvas aspect (w/h) per animation — frames within one anim share a canvas. */
const ASPECT: Record<Anim, number> = {
  idle: 71 / 148,
  run: 130 / 112,
  punch: 129 / 120,
  victory: 60 / 104,
};

/** Punch reads better as jab-out-jab-back; the rest cycle forward. */
const SEQUENCE: Record<Anim, number[]> = {
  idle: [0, 1, 2, 3, 4, 5],
  run: [0, 1, 2, 3, 4, 5, 6],
  punch: [0, 1, 2, 2, 1, 0],
  victory: [0, 1, 2, 2, 1],
};

const FPS: Record<Anim, number> = { idle: 5, run: 14, punch: 9, victory: 5 };

/** One stacked frame: visible only during its slots of the UI-thread clock. */
function SpriteFrame({
  source,
  index,
  clock,
  sequence,
  frozen,
  width,
  height,
}: {
  source: number;
  index: number;
  clock: SharedValue<number>;
  sequence: number[];
  frozen: boolean;
  width: number;
  height: number;
}) {
  const style = useAnimatedStyle(() => {
    const step = frozen ? 0 : Math.min(Math.floor(clock.value), sequence.length - 1);
    return { opacity: sequence[step] === index ? 1 : 0 };
  });
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width, height }, style]}>
      <Image source={source} style={{ width, height }} contentFit="contain" cachePolicy="memory" />
    </Animated.View>
  );
}

export function SpriteAvatar({ anim, height = 72 }: { anim: Anim; height?: number }) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const frozen = reducedMotion || perfMode;
  const clock = useSharedValue(0);

  const seq = SEQUENCE[anim];
  useEffect(() => {
    if (frozen) {
      clock.value = 0;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(seq.length, { duration: (seq.length * 1000) / FPS[anim], easing: Easing.linear }),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, frozen]);

  const width = Math.round(height * ASPECT[anim]);

  return (
    <View style={{ width, height }} pointerEvents="none">
      {FRAMES[anim].map((source, i) => (
        <SpriteFrame
          key={`${anim}-${i}`}
          source={source}
          index={i}
          clock={clock}
          sequence={seq}
          frozen={frozen}
          width={width}
          height={height}
        />
      ))}
    </View>
  );
}

/** The gated placement wrapper — every call site goes through this. */
export function SpriteCompanion(props: { anim: Anim; height?: number }) {
  if (!SPRITE_COMPANION_ENABLED) return null;
  return <SpriteAvatar {...props} />;
}
