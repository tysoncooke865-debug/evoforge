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
  // Knockback when struck, and an impact burst (rings + core) at the hit —
  // the weight the flat "lunge + red flash" was missing (Tyson 2026-07-17).
  const knockX = useSharedValue(0);
  const knockY = useSharedValue(0);
  const burst = useSharedValue(1); // 1 = idle/invisible; animates 0→1 on a hit
  const critHit = useSharedValue(0); // 1 while the last hit was a crit (amber)

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
      // Anticipation → strike → recover: wind back first, snap forward, ease home.
      lx.value = withSequence(
        withTiming(-dx * 0.28, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(dx, { duration: 90, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 240, easing: Easing.inOut(Easing.quad) })
      );
      ly.value = withSequence(
        withTiming(-dy * 0.28, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(dy, { duration: 90, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 240, easing: Easing.inOut(Easing.quad) })
      );
    }
    if (isHit) {
      const crit = activeEvent.kind === 'crit';
      const mag = crit ? 12 : 7;
      shake.value = withSequence(
        withTiming(-mag, { duration: 45 }), withTiming(mag, { duration: 45 }),
        withTiming(-mag * 0.6, { duration: 45 }), withTiming(0, { duration: 60 })
      );
      flash.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 240 }));
      // Knock the struck sprite AWAY from the foe, then settle back.
      const kmag = crit ? 20 : 11;
      const kx = side === 'player' ? -kmag : kmag;
      const ky = side === 'player' ? kmag * 0.6 : -kmag * 0.6;
      knockX.value = withSequence(withTiming(kx, { duration: 70, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
      knockY.value = withSequence(withTiming(ky, { duration: 70, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
      // Impact burst rings + core expand out from the point of contact.
      critHit.value = crit ? 1 : 0;
      burst.value = 0;
      burst.value = withTiming(1, { duration: crit ? 420 : 320, easing: Easing.out(Easing.quad) });
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
    transform: [
      { translateX: lx.value + shake.value + knockX.value },
      { translateY: ly.value + bob.value + knockY.value },
    ],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  // Impact burst layers — expanding rings + a bright core, invisible at rest
  // (burst = 1). Crit tints warmer via critHit.
  const ring1Style = useAnimatedStyle(() => ({ opacity: (1 - burst.value) * 0.9, transform: [{ scale: 0.4 + burst.value * 1.8 }] }));
  const ring2Style = useAnimatedStyle(() => ({ opacity: (1 - burst.value) * 0.6, transform: [{ scale: 0.25 + burst.value * 1.05 }] }));
  const coreStyle = useAnimatedStyle(() => ({ opacity: (1 - burst.value) * 0.95, transform: [{ scale: 0.5 + burst.value * 0.65 }] }));
  const critTintStyle = useAnimatedStyle(() => ({ opacity: critHit.value }));

  const src = battlePovArt(branch, stage, pov);
  const ringSize = size * 0.62;
  const burstTop = size * 0.3;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View style={[{ position: 'absolute', bottom: 2, width: size * 0.85, height: size * 0.34, borderRadius: size, backgroundColor: '#22d3ee', shadowColor: '#22d3ee', shadowOpacity: 0.9, shadowRadius: 22 }, glowStyle]} pointerEvents="none" />
      <Animated.View style={style}>
        <Image source={src} style={{ width: size, height: size, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: '#fb7185' }, flashStyle]} />
      </Animated.View>
      {/* Impact burst (over the sprite, fixed to the hit point). */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: burstTop, width: ringSize, height: ringSize, borderRadius: ringSize, borderWidth: 3, borderColor: '#dffcff' }, ring1Style]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: burstTop + ringSize * 0.08, width: ringSize * 0.82, height: ringSize * 0.82, borderRadius: ringSize, borderWidth: 2, borderColor: '#9fe8ff' }, ring2Style]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: burstTop + ringSize * 0.2, width: ringSize * 0.5, height: ringSize * 0.5, borderRadius: ringSize, backgroundColor: '#f2feff', shadowColor: '#bdf3ff', shadowOpacity: 0.9, shadowRadius: 14 }, coreStyle]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: burstTop + ringSize * 0.2, width: ringSize * 0.5, height: ringSize * 0.5, borderRadius: ringSize, backgroundColor: '#fde68a' }, coreStyle, critTintStyle]} />
    </View>
  );
}
