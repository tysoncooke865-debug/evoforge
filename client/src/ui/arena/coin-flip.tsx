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

/**
 * The HEADS OR TAILS coin (Tyson's gold anvil coin, 2026-07-12). While
 * `spinning` it cycles heads → edge → tails → edge through the SPRITE
 * RENDERING CONTRACT machinery (CSS steps() over a strip on web — zero JS
 * per frame; Reanimated stacked frames on native). When the server verdict
 * lands, spinning stops and ONE static face renders (a single source
 * assignment — the contract forbids per-frame source swaps, not state
 * transitions). The parent flips `spinning` off when the verdict lands.
 *
 * P8: the spin IS bounded, but it is still a fast rotating object, which is
 * exactly what a vestibular-sensitive athlete asked the OS to stop. Under
 * reduced motion the coin renders its FACE and never spins — the verdict is
 * carried by the face, not by the motion, so nothing is lost but the flourish.
 */

const STRIP = require('../../assets/battle/coin_flip_strip.png');
const FACES: Record<string, number> = {
  heads: require('../../assets/battle/coin_heads.png'),
  tails: require('../../assets/battle/coin_tails.png'),
};
const FRAMES = [
  require('../../assets/battle/coin_heads.png'),
  require('../../assets/battle/coin_edge.png'),
  require('../../assets/battle/coin_tails.png'),
  require('../../assets/battle/coin_edge.png'),
];
const N = 4;
const SPIN_SECONDS = 0.4;

function WebSpin({ size }: { size: number }) {
  const uri = Asset.fromModule(STRIP).uri;
  if (typeof document !== 'undefined' && !document.getElementById('evoforge-sprite-kf')) {
    const style = document.createElement('style');
    style.id = 'evoforge-sprite-kf';
    style.textContent =
      '@keyframes evoforge-sprite { from { background-position-x: 0%; } to { background-position-x: 100%; } }';
    document.head.appendChild(style);
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${uri})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${N * 100}% 100%`,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
        // steps(N, jump-none): N treads at k/(N-1) — the sprite-strip lesson.
        animation: `evoforge-sprite ${SPIN_SECONDS}s steps(${N}, jump-none) infinite`,
      }}
    />
  );
}

function NativeFrame({ source, index, clock, size }: { source: number; index: number; clock: SharedValue<number>; size: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(Math.floor(clock.value), N - 1) === index ? 1 : 0,
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width: size, height: size }, style]}>
      <Image source={source} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory" />
    </Animated.View>
  );
}

function NativeSpin({ size }: { size: number }) {
  const clock = useSharedValue(0);
  useEffect(() => {
    clock.value = 0;
    clock.value = withRepeat(withTiming(N, { duration: SPIN_SECONDS * 1000, easing: Easing.linear }), -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {FRAMES.map((source, i) => (
        <NativeFrame key={i} source={source} index={i} clock={clock} size={size} />
      ))}
    </>
  );
}

export function CoinFlip({ spinning, face, size = 132 }: { spinning: boolean; face: 'heads' | 'tails'; size?: number }) {
  const reducedMotion = useReducedMotion();
  const spin = spinning && !reducedMotion;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {spin ? (
        Platform.OS === 'web' ? (
          <WebSpin size={size} />
        ) : (
          <NativeSpin size={size} />
        )
      ) : (
        <Image source={FACES[face] ?? FACES.heads} style={{ width: size, height: size }} contentFit="contain" />
      )}
    </View>
  );
}
