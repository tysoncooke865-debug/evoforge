import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { useEffect } from 'react';
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

import { useAvatarData } from '@/data/use-avatar-data';
import { getBranchStage } from '@/domain/avatar-stats';
import { shredderStage } from '@/domain/branches-v2';
import { useSettingsStore } from '@/state/settings-store';

/**
 * The animated pixel companion — Tyson's Cyber Athlete LV.1–LV.4 sheets,
 * one per avatar STAGE, so the sprite matures with the character.
 *
 * RENDERING CONTRACT, three live bugs deep:
 *  - WEB: pure CSS steps() over a per-stage sprite STRIP. Zero JavaScript
 *    per frame (JS timers AND main-thread Reanimated worklets both broke
 *    first-tap presses on iOS).
 *  - NATIVE: Reanimated stacked frames on the real UI thread.
 *  - Frames stay pre-loaded either way; source-swapping is what flickers.
 *
 * REMOVAL SWITCH: flip SPRITE_COMPANION_ENABLED to false and every
 * companion on every page disappears cleanly.
 */
export const SPRITE_COMPANION_ENABLED = true;

type Anim = 'idle' | 'run' | 'punch' | 'victory';
type Stage = 1 | 2 | 3 | 4;

const STRIPS: Record<Stage, Record<Anim, number>> = {
  1: {
    idle: require('../../assets/avatars/sprites/lv1_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv1_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv1_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv1_victory_strip.png'),
  },
  2: {
    idle: require('../../assets/avatars/sprites/lv2_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv2_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv2_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv2_victory_strip.png'),
  },
  3: {
    idle: require('../../assets/avatars/sprites/lv3_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv3_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv3_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv3_victory_strip.png'),
  },
  4: {
    idle: require('../../assets/avatars/sprites/lv4_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv4_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv4_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv4_victory_strip.png'),
  },
};

const FRAMES: Record<Stage, Record<Anim, number[]>> = {
  1: {
    idle: [
      require('../../assets/avatars/sprites/lv1_idle_1.png'),
      require('../../assets/avatars/sprites/lv1_idle_2.png'),
      require('../../assets/avatars/sprites/lv1_idle_3.png'),
      require('../../assets/avatars/sprites/lv1_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv1_run_1.png'),
      require('../../assets/avatars/sprites/lv1_run_2.png'),
      require('../../assets/avatars/sprites/lv1_run_3.png'),
      require('../../assets/avatars/sprites/lv1_run_4.png'),
      require('../../assets/avatars/sprites/lv1_run_5.png'),
      require('../../assets/avatars/sprites/lv1_run_6.png'),
      require('../../assets/avatars/sprites/lv1_run_7.png'),
      require('../../assets/avatars/sprites/lv1_run_8.png'),
      require('../../assets/avatars/sprites/lv1_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv1_punch_1.png'),
      require('../../assets/avatars/sprites/lv1_punch_2.png'),
      require('../../assets/avatars/sprites/lv1_punch_3.png'),
      require('../../assets/avatars/sprites/lv1_punch_4.png'),
      require('../../assets/avatars/sprites/lv1_punch_5.png'),
      require('../../assets/avatars/sprites/lv1_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv1_victory_1.png'),
      require('../../assets/avatars/sprites/lv1_victory_2.png'),
      require('../../assets/avatars/sprites/lv1_victory_3.png'),
    ],
  },
  2: {
    idle: [
      require('../../assets/avatars/sprites/lv2_idle_1.png'),
      require('../../assets/avatars/sprites/lv2_idle_2.png'),
      require('../../assets/avatars/sprites/lv2_idle_3.png'),
      require('../../assets/avatars/sprites/lv2_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv2_run_1.png'),
      require('../../assets/avatars/sprites/lv2_run_2.png'),
      require('../../assets/avatars/sprites/lv2_run_3.png'),
      require('../../assets/avatars/sprites/lv2_run_4.png'),
      require('../../assets/avatars/sprites/lv2_run_5.png'),
      require('../../assets/avatars/sprites/lv2_run_6.png'),
      require('../../assets/avatars/sprites/lv2_run_7.png'),
      require('../../assets/avatars/sprites/lv2_run_8.png'),
      require('../../assets/avatars/sprites/lv2_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv2_punch_1.png'),
      require('../../assets/avatars/sprites/lv2_punch_2.png'),
      require('../../assets/avatars/sprites/lv2_punch_3.png'),
      require('../../assets/avatars/sprites/lv2_punch_4.png'),
      require('../../assets/avatars/sprites/lv2_punch_5.png'),
      require('../../assets/avatars/sprites/lv2_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv2_victory_1.png'),
      require('../../assets/avatars/sprites/lv2_victory_2.png'),
      require('../../assets/avatars/sprites/lv2_victory_3.png'),
    ],
  },
  3: {
    idle: [
      require('../../assets/avatars/sprites/lv3_idle_1.png'),
      require('../../assets/avatars/sprites/lv3_idle_2.png'),
      require('../../assets/avatars/sprites/lv3_idle_3.png'),
      require('../../assets/avatars/sprites/lv3_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv3_run_1.png'),
      require('../../assets/avatars/sprites/lv3_run_2.png'),
      require('../../assets/avatars/sprites/lv3_run_3.png'),
      require('../../assets/avatars/sprites/lv3_run_4.png'),
      require('../../assets/avatars/sprites/lv3_run_5.png'),
      require('../../assets/avatars/sprites/lv3_run_6.png'),
      require('../../assets/avatars/sprites/lv3_run_7.png'),
      require('../../assets/avatars/sprites/lv3_run_8.png'),
      require('../../assets/avatars/sprites/lv3_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv3_punch_1.png'),
      require('../../assets/avatars/sprites/lv3_punch_2.png'),
      require('../../assets/avatars/sprites/lv3_punch_3.png'),
      require('../../assets/avatars/sprites/lv3_punch_4.png'),
      require('../../assets/avatars/sprites/lv3_punch_5.png'),
      require('../../assets/avatars/sprites/lv3_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv3_victory_1.png'),
      require('../../assets/avatars/sprites/lv3_victory_2.png'),
      require('../../assets/avatars/sprites/lv3_victory_3.png'),
    ],
  },
  4: {
    idle: [
      require('../../assets/avatars/sprites/lv4_idle_1.png'),
      require('../../assets/avatars/sprites/lv4_idle_2.png'),
      require('../../assets/avatars/sprites/lv4_idle_3.png'),
      require('../../assets/avatars/sprites/lv4_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv4_run_1.png'),
      require('../../assets/avatars/sprites/lv4_run_2.png'),
      require('../../assets/avatars/sprites/lv4_run_3.png'),
      require('../../assets/avatars/sprites/lv4_run_4.png'),
      require('../../assets/avatars/sprites/lv4_run_5.png'),
      require('../../assets/avatars/sprites/lv4_run_6.png'),
      require('../../assets/avatars/sprites/lv4_run_7.png'),
      require('../../assets/avatars/sprites/lv4_run_8.png'),
      require('../../assets/avatars/sprites/lv4_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv4_punch_1.png'),
      require('../../assets/avatars/sprites/lv4_punch_2.png'),
      require('../../assets/avatars/sprites/lv4_punch_3.png'),
      require('../../assets/avatars/sprites/lv4_punch_4.png'),
      require('../../assets/avatars/sprites/lv4_punch_5.png'),
      require('../../assets/avatars/sprites/lv4_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv4_victory_1.png'),
      require('../../assets/avatars/sprites/lv4_victory_2.png'),
      require('../../assets/avatars/sprites/lv4_victory_3.png'),
    ],
  },
};
/** Female set (2026-07-12): same uniform counts, sliced from Tyson's female
 *  LV.1-4 animation sheets by scratchpad slice_female.py. */
const STRIPS_F: Record<Stage, Record<Anim, number>> = {
  1: {
    idle: require('../../assets/avatars/sprites/lv1f_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv1f_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv1f_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv1f_victory_strip.png'),
  },
  2: {
    idle: require('../../assets/avatars/sprites/lv2f_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv2f_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv2f_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv2f_victory_strip.png'),
  },
  3: {
    idle: require('../../assets/avatars/sprites/lv3f_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv3f_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv3f_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv3f_victory_strip.png'),
  },
  4: {
    idle: require('../../assets/avatars/sprites/lv4f_idle_strip.png'),
    run: require('../../assets/avatars/sprites/lv4f_run_strip.png'),
    punch: require('../../assets/avatars/sprites/lv4f_punch_strip.png'),
    victory: require('../../assets/avatars/sprites/lv4f_victory_strip.png'),
  },
};

const FRAMES_F: Record<Stage, Record<Anim, number[]>> = {
  1: {
    idle: [
      require('../../assets/avatars/sprites/lv1f_idle_1.png'),
      require('../../assets/avatars/sprites/lv1f_idle_2.png'),
      require('../../assets/avatars/sprites/lv1f_idle_3.png'),
      require('../../assets/avatars/sprites/lv1f_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv1f_run_1.png'),
      require('../../assets/avatars/sprites/lv1f_run_2.png'),
      require('../../assets/avatars/sprites/lv1f_run_3.png'),
      require('../../assets/avatars/sprites/lv1f_run_4.png'),
      require('../../assets/avatars/sprites/lv1f_run_5.png'),
      require('../../assets/avatars/sprites/lv1f_run_6.png'),
      require('../../assets/avatars/sprites/lv1f_run_7.png'),
      require('../../assets/avatars/sprites/lv1f_run_8.png'),
      require('../../assets/avatars/sprites/lv1f_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv1f_punch_1.png'),
      require('../../assets/avatars/sprites/lv1f_punch_2.png'),
      require('../../assets/avatars/sprites/lv1f_punch_3.png'),
      require('../../assets/avatars/sprites/lv1f_punch_4.png'),
      require('../../assets/avatars/sprites/lv1f_punch_5.png'),
      require('../../assets/avatars/sprites/lv1f_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv1f_victory_1.png'),
      require('../../assets/avatars/sprites/lv1f_victory_2.png'),
      require('../../assets/avatars/sprites/lv1f_victory_3.png'),
    ],
  },
  2: {
    idle: [
      require('../../assets/avatars/sprites/lv2f_idle_1.png'),
      require('../../assets/avatars/sprites/lv2f_idle_2.png'),
      require('../../assets/avatars/sprites/lv2f_idle_3.png'),
      require('../../assets/avatars/sprites/lv2f_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv2f_run_1.png'),
      require('../../assets/avatars/sprites/lv2f_run_2.png'),
      require('../../assets/avatars/sprites/lv2f_run_3.png'),
      require('../../assets/avatars/sprites/lv2f_run_4.png'),
      require('../../assets/avatars/sprites/lv2f_run_5.png'),
      require('../../assets/avatars/sprites/lv2f_run_6.png'),
      require('../../assets/avatars/sprites/lv2f_run_7.png'),
      require('../../assets/avatars/sprites/lv2f_run_8.png'),
      require('../../assets/avatars/sprites/lv2f_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv2f_punch_1.png'),
      require('../../assets/avatars/sprites/lv2f_punch_2.png'),
      require('../../assets/avatars/sprites/lv2f_punch_3.png'),
      require('../../assets/avatars/sprites/lv2f_punch_4.png'),
      require('../../assets/avatars/sprites/lv2f_punch_5.png'),
      require('../../assets/avatars/sprites/lv2f_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv2f_victory_1.png'),
      require('../../assets/avatars/sprites/lv2f_victory_2.png'),
      require('../../assets/avatars/sprites/lv2f_victory_3.png'),
    ],
  },
  3: {
    idle: [
      require('../../assets/avatars/sprites/lv3f_idle_1.png'),
      require('../../assets/avatars/sprites/lv3f_idle_2.png'),
      require('../../assets/avatars/sprites/lv3f_idle_3.png'),
      require('../../assets/avatars/sprites/lv3f_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv3f_run_1.png'),
      require('../../assets/avatars/sprites/lv3f_run_2.png'),
      require('../../assets/avatars/sprites/lv3f_run_3.png'),
      require('../../assets/avatars/sprites/lv3f_run_4.png'),
      require('../../assets/avatars/sprites/lv3f_run_5.png'),
      require('../../assets/avatars/sprites/lv3f_run_6.png'),
      require('../../assets/avatars/sprites/lv3f_run_7.png'),
      require('../../assets/avatars/sprites/lv3f_run_8.png'),
      require('../../assets/avatars/sprites/lv3f_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv3f_punch_1.png'),
      require('../../assets/avatars/sprites/lv3f_punch_2.png'),
      require('../../assets/avatars/sprites/lv3f_punch_3.png'),
      require('../../assets/avatars/sprites/lv3f_punch_4.png'),
      require('../../assets/avatars/sprites/lv3f_punch_5.png'),
      require('../../assets/avatars/sprites/lv3f_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv3f_victory_1.png'),
      require('../../assets/avatars/sprites/lv3f_victory_2.png'),
      require('../../assets/avatars/sprites/lv3f_victory_3.png'),
    ],
  },
  4: {
    idle: [
      require('../../assets/avatars/sprites/lv4f_idle_1.png'),
      require('../../assets/avatars/sprites/lv4f_idle_2.png'),
      require('../../assets/avatars/sprites/lv4f_idle_3.png'),
      require('../../assets/avatars/sprites/lv4f_idle_4.png'),
    ],
    run: [
      require('../../assets/avatars/sprites/lv4f_run_1.png'),
      require('../../assets/avatars/sprites/lv4f_run_2.png'),
      require('../../assets/avatars/sprites/lv4f_run_3.png'),
      require('../../assets/avatars/sprites/lv4f_run_4.png'),
      require('../../assets/avatars/sprites/lv4f_run_5.png'),
      require('../../assets/avatars/sprites/lv4f_run_6.png'),
      require('../../assets/avatars/sprites/lv4f_run_7.png'),
      require('../../assets/avatars/sprites/lv4f_run_8.png'),
      require('../../assets/avatars/sprites/lv4f_run_9.png'),
    ],
    punch: [
      require('../../assets/avatars/sprites/lv4f_punch_1.png'),
      require('../../assets/avatars/sprites/lv4f_punch_2.png'),
      require('../../assets/avatars/sprites/lv4f_punch_3.png'),
      require('../../assets/avatars/sprites/lv4f_punch_4.png'),
      require('../../assets/avatars/sprites/lv4f_punch_5.png'),
      require('../../assets/avatars/sprites/lv4f_punch_6.png'),
    ],
    victory: [
      require('../../assets/avatars/sprites/lv4f_victory_1.png'),
      require('../../assets/avatars/sprites/lv4f_victory_2.png'),
      require('../../assets/avatars/sprites/lv4f_victory_3.png'),
    ],
  },
};

const COUNT: Record<Anim, number> = { idle: 4, run: 9, punch: 6, victory: 3 };

/** Canvas aspect (w/h) per stage+animation. */
const ASPECT: Record<Stage, Record<Anim, number>> = {
  1: { idle: 95 / 186, run: 143 / 172, punch: 185 / 172, victory: 113 / 187 },
  2: { idle: 99 / 198, run: 154 / 170, punch: 224 / 168, victory: 120 / 206 },
  3: { idle: 153 / 239, run: 161 / 171, punch: 182 / 160, victory: 154 / 215 },
  4: { idle: 124 / 218, run: 147 / 172, punch: 181 / 166, victory: 139 / 214 },
};

const ASPECT_F: Record<Stage, Record<Anim, number>> = {
  1: { idle: 102 / 219, run: 157 / 184, punch: 180 / 180, victory: 117 / 215 },
  2: { idle: 94 / 202, run: 137 / 171, punch: 201 / 171, victory: 113 / 211 },
  3: { idle: 117 / 248, run: 156 / 175, punch: 219 / 170, victory: 117 / 221 },
  4: { idle: 112 / 206, run: 152 / 172, punch: 217 / 171, victory: 129 / 219 },
};

type Sex = 'male' | 'female';
const stripsFor = (sex: Sex) => (sex === 'female' ? STRIPS_F : STRIPS);
const framesFor = (sex: Sex) => (sex === 'female' ? FRAMES_F : FRAMES);
const aspectFor = (sex: Sex) => (sex === 'female' ? ASPECT_F : ASPECT);

const FPS: Record<Anim, number> = { idle: 5, run: 14, punch: 10, victory: 5 };

/** Victory reads better bouncing; the rest are full forward cycles. */
const ALTERNATE: Record<Anim, boolean> = { idle: false, run: false, punch: false, victory: true };

// ---------------------------------------------------------------- web

/** Browser-native sprite playback: background-position through steps(). */
function CssSprite({ stage, anim, sex, width, height, frozen }: { stage: Stage; anim: Anim; sex: Sex; width: number; height: number; frozen: boolean }) {
  const n = COUNT[anim];
  // resolveAssetSource does not exist on react-native-web; expo-asset
  // resolves Metro module ids to served URLs on every platform.
  const uri = Asset.fromModule(stripsFor(sex)[stage][anim]).uri;
  // Keyframes injected once, keyed by DOM id (no module-scope reassignment —
  // the react compiler lint forbids it inside a component).
  if (typeof document !== 'undefined' && !document.getElementById('evoforge-sprite-kf')) {
    const style = document.createElement('style');
    style.id = 'evoforge-sprite-kf';
    style.textContent =
      '@keyframes evoforge-sprite { from { background-position-x: 0%; } to { background-position-x: 100%; } }';
    document.head.appendChild(style);
  }
  const duration = n / FPS[anim];
  const animation = frozen
    ? undefined
    : `evoforge-sprite ${duration}s steps(${n}, jump-none) infinite${ALTERNATE[anim] ? ' alternate' : ''}`;
  return (
    <div
      style={{
        width,
        height,
        backgroundImage: `url(${uri})`,
        backgroundRepeat: 'no-repeat',
        // Frame k of n sits at background-position-x k/(n-1)*100%.
        // steps(n, jump-none) holds BOTH endpoints, yielding exactly n treads
        // at k/(n-1) — one per frame, all on the tile grid. steps(n-1) put
        // treads at k/(n-2), BETWEEN tiles: two half-frames with a marching
        // seam that read as the strip scrolling sideways (live bug).
        backgroundSize: `${n * 100}% 100%`,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
        animation,
      }}
    />
  );
}

// ---------------------------------------------------------------- native

function SpriteFrame({
  source,
  index,
  clock,
  count,
  frozen,
  width,
  height,
}: {
  source: number;
  index: number;
  clock: SharedValue<number>;
  count: number;
  frozen: boolean;
  width: number;
  height: number;
}) {
  const style = useAnimatedStyle(() => {
    const step = frozen ? 0 : Math.min(Math.floor(clock.value), count - 1);
    return { opacity: step === index ? 1 : 0 };
  });
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width, height }, style]}>
      <Image source={source} style={{ width, height }} contentFit="contain" cachePolicy="memory" />
    </Animated.View>
  );
}

function NativeSprite({ stage, anim, sex, width, height, frozen }: { stage: Stage; anim: Anim; sex: Sex; width: number; height: number; frozen: boolean }) {
  const clock = useSharedValue(0);
  const n = COUNT[anim];
  useEffect(() => {
    if (frozen) {
      clock.value = 0;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(withTiming(n, { duration: (n * 1000) / FPS[anim], easing: Easing.linear }), -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, frozen]);
  return (
    <>
      {framesFor(sex)[stage][anim].map((source, i) => (
        <SpriteFrame
          key={`${sex}-${stage}-${anim}-${i}`}
          source={source}
          index={i}
          clock={clock}
          count={n}
          frozen={frozen}
          width={width}
          height={height}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- api

export function SpriteAvatar({ anim, stage = 1, sex = 'male', height = 72 }: { anim: Anim; stage?: Stage; sex?: Sex; height?: number }) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const frozen = reducedMotion || perfMode;
  const width = Math.round(height * aspectFor(sex)[stage][anim]);

  return (
    <View style={{ width, height }} pointerEvents="none">
      {Platform.OS === 'web' ? (
        <CssSprite stage={stage} anim={anim} sex={sex} width={width} height={height} frozen={frozen} />
      ) : (
        <NativeSprite stage={stage} anim={anim} sex={sex} width={width} height={height} frozen={frozen} />
      )}
    </View>
  );
}

/**
 * The gated placement wrapper — every call site goes through this. It
 * derives the athlete's CURRENT stage (shredder stages by body fat,
 * everyone else by the branch/level ladder), so the companion matures
 * with the character everywhere at once.
 */
export function SpriteCompanion(props: { anim: Anim; height?: number }) {
  const { stats, summary, branchV2, bfMid, sex } = useAvatarData();
  if (!SPRITE_COMPANION_ENABLED) return null;
  const raw = branchV2 === 'shredder' ? shredderStage(bfMid) : getBranchStage(stats.branch, summary.level);
  const stage = Math.min(4, Math.max(1, raw)) as Stage;
  return <SpriteAvatar {...props} stage={stage} sex={sex} />;
}
