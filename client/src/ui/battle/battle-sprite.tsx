import { Image } from 'expo-image';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { BattleEvent, SpriteBranch } from '@/domain/battle-rpg/types';

import { battlePovArt } from './battle-pov-art';

/**
 * A Pokémon-POV battle sprite. The PLAYER shows their back (lower-left, big),
 * the OPPONENT their front (upper-right, smaller) — the art already faces the
 * right way, so no mirroring. Animation via transforms only: idle bob, a
 * DIAGONAL lunge toward the foe, hit shake + red flash, defeat fade, victory
 * glow. Reduced motion collapses to a static sprite.
 */
export function BattleSprite({
  branch,
  stage,
  side,
  activeEvent,
  size = 130,
  defeated = false,
  victory = false,
}: {
  branch: SpriteBranch;
  stage: number;
  side: 'player' | 'opponent';
  activeEvent: BattleEvent | null;
  size?: number;
  defeated?: boolean;
  victory?: boolean;
}) {
  const reduced = useReducedMotion();
  const pov = side === 'player' ? 'back' : 'front';
  const bob = useSharedValue(0);
  const lx = useSharedValue(0);
  const ly = useSharedValue(0);
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const fade = useSharedValue(1);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (reduced || defeated) { bob.value = 0; return; }
    bob.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 950, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 950, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
  }, [reduced, defeated, bob]);

  useEffect(() => {
    if (!activeEvent || reduced) return;
    const isMover = activeEvent.kind === 'move' && activeEvent.side === side;
    const isHit = (activeEvent.kind === 'damage' || activeEvent.kind === 'crit') && activeEvent.side === side;
    if (isMover && activeEvent.animationType !== 'buff' && activeEvent.animationType !== 'recovery' && activeEvent.animationType !== 'defence') {
      // Lunge along the diagonal toward the foe (player up-right, foe down-left).
      const dist = activeEvent.animationType === 'quick' ? 28 : activeEvent.animationType === 'ultimate' || activeEvent.animationType === 'heavy' ? 46 : 22;
      const dx = side === 'player' ? dist : -dist;
      const dy = side === 'player' ? -dist * 0.7 : dist * 0.7;
      lx.value = withSequence(withTiming(dx, { duration: 130, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 260, easing: Easing.inOut(Easing.quad) }));
      ly.value = withSequence(withTiming(dy, { duration: 130, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 260, easing: Easing.inOut(Easing.quad) }));
    }
    if (isHit) {
      const mag = activeEvent.kind === 'crit' ? 12 : 7;
      shake.value = withSequence(
        withTiming(-mag, { duration: 45 }), withTiming(mag, { duration: 45 }),
        withTiming(-mag * 0.6, { duration: 45 }), withTiming(0, { duration: 60 })
      );
      flash.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 240 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent]);

  useEffect(() => { fade.value = withTiming(defeated ? 0.12 : 1, { duration: 550 }); }, [defeated, fade]);
  useEffect(() => {
    if (victory && !reduced) glow.value = withRepeat(withSequence(withTiming(1, { duration: 520 }), withTiming(0.3, { duration: 520 })), -1);
    else glow.value = withTiming(0, { duration: 300 });
  }, [victory, reduced, glow]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: lx.value + shake.value }, { translateY: ly.value + bob.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const src = battlePovArt(branch, stage, pov);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View style={[{ position: 'absolute', bottom: 2, width: size * 0.85, height: size * 0.34, borderRadius: size, backgroundColor: '#22d3ee', shadowColor: '#22d3ee', shadowOpacity: 0.9, shadowRadius: 22 }, glowStyle]} pointerEvents="none" />
      <Animated.View style={style}>
        <Image source={src} style={{ width: size, height: size, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: '#fb7185' }, flashStyle]} />
      </Animated.View>
    </View>
  );
}
