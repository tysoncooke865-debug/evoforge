import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useSettingsStore } from '@/state/settings-store';

/**
 * The animated pixel companion (Tyson's Cyber Athlete sheet, level 1),
 * sliced into per-frame PNGs in assets/avatars/sprites/. Frame-flipping is
 * plain state on a timer — cheap, and it freezes to frame 1 under reduced
 * motion or perf mode, exactly like every ambient loop in the app.
 *
 * REMOVAL SWITCH: flip SPRITE_COMPANION_ENABLED to false and every
 * companion on every page disappears — the layouts collapse cleanly, no
 * other change needed. (Tyson's condition for shipping this.)
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
  run: 126 / 112,
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

const FPS: Record<Anim, number> = { idle: 5, run: 11, punch: 9, victory: 5 };

export function SpriteAvatar({ anim, height = 72 }: { anim: Anim; height?: number }) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const frozen = reducedMotion || perfMode;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (frozen) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000 / FPS[anim]);
    return () => clearInterval(t);
  }, [anim, frozen]);

  const seq = SEQUENCE[anim];
  const frame = FRAMES[anim][frozen ? seq[0] : seq[tick % seq.length]];
  const width = Math.round(height * ASPECT[anim]);

  return (
    <View style={{ width, height }} pointerEvents="none">
      <Image source={frame} style={{ width, height }} contentFit="contain" />
    </View>
  );
}

/** The gated placement wrapper — every call site goes through this. */
export function SpriteCompanion(props: { anim: Anim; height?: number }) {
  if (!SPRITE_COMPANION_ENABLED) return null;
  return <SpriteAvatar {...props} />;
}
