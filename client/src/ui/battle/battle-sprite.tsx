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
import { avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';

/**
 * A battle sprite with beta-friendly "animation via transforms": idle bob,
 * an attack lunge toward the foe, a hit shake + red flash, a defeat fade and
 * a victory glow — all from the existing still art, no new sheets. Reduced
 * motion collapses to a static sprite.
 */
export function BattleSprite({
  branch,
  stage,
  side,
  activeEvent,
  size = 120,
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
  const bob = useSharedValue(0);
  const lunge = useSharedValue(0);
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const fade = useSharedValue(1);
  const glow = useSharedValue(0);

  // Idle bob.
  useEffect(() => {
    if (reduced || defeated) { bob.value = 0; return; }
    bob.value = withRepeat(withSequence(withTiming(-4, { duration: 900, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })), -1);
  }, [reduced, defeated, bob]);

  // React to the active event (this sprite is the ACTOR when event.side is
  // the opposite — a move by 'player' means the player lunges; damage TO this
  // side shakes it).
  useEffect(() => {
    if (!activeEvent || reduced) return;
    const dir = side === 'player' ? 1 : -1;
    const isMover = activeEvent.kind === 'move' && actorSide(activeEvent) === side;
    const isHit = (activeEvent.kind === 'damage' || activeEvent.kind === 'crit') && activeEvent.side === side;
    if (isMover) {
      const dist = activeEvent.animationType === 'quick' ? 26 : activeEvent.animationType === 'ultimate' || activeEvent.animationType === 'heavy' ? 40 : 20;
      lunge.value = withSequence(
        withTiming(dir * dist, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 240, easing: Easing.inOut(Easing.quad) })
      );
    }
    if (isHit) {
      const mag = activeEvent.kind === 'crit' ? 12 : 7;
      shake.value = withSequence(
        withTiming(-mag, { duration: 45 }), withTiming(mag, { duration: 45 }),
        withTiming(-mag * 0.6, { duration: 45 }), withTiming(0, { duration: 60 })
      );
      flash.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 220 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent]);

  useEffect(() => { fade.value = withTiming(defeated ? 0.15 : 1, { duration: 500 }); }, [defeated, fade]);
  useEffect(() => {
    if (victory && !reduced) glow.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1);
    else glow.value = withTiming(0, { duration: 300 });
  }, [victory, reduced, glow]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateX: lunge.value + shake.value },
      { translateY: bob.value },
      { scaleX: side === 'opponent' ? -1 : 1 }, // face the centre
    ],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const src = stillAvatar(branch, stage, 'male') ?? avatarArtV2(branch, stage, 'male').source;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View style={[{ position: 'absolute', bottom: 0, width: size * 0.9, height: size * 0.4, borderRadius: size, backgroundColor: '#22d3ee', shadowColor: '#22d3ee', shadowOpacity: 0.9, shadowRadius: 24 }, glowStyle]} pointerEvents="none" />
      <Animated.View style={style}>
        <Image source={src} style={{ width: size, height: size, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
        {/* Red hit flash overlay. */}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: '#fb7185' }, flashStyle]} />
      </Animated.View>
    </View>
  );
}

/** The side that ACTED for a move event — the move message names the actor,
 *  and event.side for a 'move' is the actor's side. */
function actorSide(e: BattleEvent): 'player' | 'opponent' {
  return e.side;
}
