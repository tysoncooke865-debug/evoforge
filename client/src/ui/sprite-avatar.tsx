/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated in effects by design; see neon-button.tsx. */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Asset } from 'expo-asset';
import { Platform, View } from 'react-native';
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
 * RENDERING CONTRACT, three live bugs deep:
 *  - WEB: pure CSS steps() animation over a sprite STRIP. Zero JavaScript
 *    per frame. Both JS-timer state flipping AND Reanimated opacity
 *    worklets (which run on the MAIN thread on web — a browser has no
 *    separate UI thread) made iOS Safari drop first taps app-wide. The
 *    browser compositor cannot break touch handling.
 *  - NATIVE: Reanimated stacked frames on the real UI thread.
 *  - Frames stay pre-loaded either way; source-swapping is what flickers.
 *
 * REMOVAL SWITCH: flip SPRITE_COMPANION_ENABLED to false and every
 * companion on every page disappears cleanly.
 */
export const SPRITE_COMPANION_ENABLED = true;

type Anim = 'idle' | 'run' | 'punch' | 'victory';

/* eslint-disable @typescript-eslint/no-require-imports */
const STRIPS: Record<Anim, number> = {
  idle: require('../assets/avatars/sprites/idle_strip.png'),
  run: require('../assets/avatars/sprites/run_strip.png'),
  punch: require('../assets/avatars/sprites/punch_strip.png'),
  victory: require('../assets/avatars/sprites/victory_strip.png'),
};

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

const COUNT: Record<Anim, number> = { idle: 6, run: 7, punch: 3, victory: 3 };

/** Canvas aspect (w/h) per animation — frames within one anim share a canvas. */
const ASPECT: Record<Anim, number> = {
  idle: 71 / 148,
  run: 130 / 112,
  punch: 129 / 120,
  victory: 60 / 104,
};

const FPS: Record<Anim, number> = { idle: 5, run: 14, punch: 9, victory: 5 };

/** Punch and victory read better bouncing back and forth. */
const ALTERNATE: Record<Anim, boolean> = { idle: false, run: false, punch: true, victory: true };

// ---------------------------------------------------------------- web

let cssInjected = false;

/** Browser-native sprite playback: background-position through steps(). */
function CssSprite({ anim, width, height, frozen }: { anim: Anim; width: number; height: number; frozen: boolean }) {
  const n = COUNT[anim];
  // resolveAssetSource does not exist on react-native-web; expo-asset
  // resolves Metro module ids to served URLs on every platform.
  const uri = Asset.fromModule(STRIPS[anim]).uri;
  if (!cssInjected && typeof document !== 'undefined') {
    cssInjected = true;
    const style = document.createElement('style');
    style.textContent =
      '@keyframes evoforge-sprite { from { background-position-x: 0%; } to { background-position-x: 100%; } }';
    document.head.appendChild(style);
  }
  const duration = n / FPS[anim];
  const animation = frozen
    ? undefined
    : `evoforge-sprite ${duration}s steps(${n - 1}, jump-none) infinite${ALTERNATE[anim] ? ' alternate' : ''}`;
  return (
    <div
      style={{
        width,
        height,
        backgroundImage: `url(${uri})`,
        backgroundRepeat: 'no-repeat',
        // A 0→100% background-position-x sweep spans (n-1) tile offsets;
        // steps(n-1, jump-none) lands on every frame exactly once.
        backgroundSize: `${n * 100}% 100%`,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
        animation,
      }}
    />
  );
}

// ---------------------------------------------------------------- native

const SEQUENCE: Record<Anim, number[]> = {
  idle: [0, 1, 2, 3, 4, 5],
  run: [0, 1, 2, 3, 4, 5, 6],
  punch: [0, 1, 2, 2, 1, 0],
  victory: [0, 1, 2, 2, 1],
};

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

function NativeSprite({ anim, width, height, frozen }: { anim: Anim; width: number; height: number; frozen: boolean }) {
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
  return (
    <>
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
    </>
  );
}

// ---------------------------------------------------------------- api

export function SpriteAvatar({ anim, height = 72 }: { anim: Anim; height?: number }) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const frozen = reducedMotion || perfMode;
  const width = Math.round(height * ASPECT[anim]);

  return (
    <View style={{ width, height }} pointerEvents="none">
      {Platform.OS === 'web' ? (
        <CssSprite anim={anim} width={width} height={height} frozen={frozen} />
      ) : (
        <NativeSprite anim={anim} width={width} height={height} frozen={frozen} />
      )}
    </View>
  );
}

/** The gated placement wrapper — every call site goes through this. */
export function SpriteCompanion(props: { anim: Anim; height?: number }) {
  if (!SPRITE_COMPANION_ENABLED) return null;
  return <SpriteAvatar {...props} />;
}
