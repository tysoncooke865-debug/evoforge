import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { ChampionId } from '@/domain/battle-rpg/types';
import { pixelFont, PIXEL } from '@/theme/fonts';
import tokens from '@/theme/tokens';

import { championSprite } from './champion-picker';

/**
 * A brief VS splash when a battle starts — the two champions slide in from
 * opposite edges and a "VS" flashes, then it fades and calls onDone. Reduced
 * motion collapses to a static half-second card.
 */
export function VsIntro({
  playerId,
  opponentId,
  playerName,
  opponentName,
  onDone,
}: {
  playerId: ChampionId;
  opponentId: ChampionId;
  playerName: string;
  opponentName: string;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const leftX = useSharedValue(reduced ? 0 : -160);
  const rightX = useSharedValue(reduced ? 0 : 160);
  const vs = useSharedValue(reduced ? 1 : 0);
  const fade = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    if (!reduced) {
      leftX.value = withTiming(0, { duration: 340, easing: ease });
      rightX.value = withTiming(0, { duration: 340, easing: ease });
      vs.value = withDelay(280, withSequence(withTiming(1.3, { duration: 140 }), withTiming(1, { duration: 120 })));
    }
    fade.value = withDelay(reduced ? 500 : 1150, withTiming(0, { duration: 260 }));
    const id = setTimeout(onDone, reduced ? 800 : 1450);
    return () => clearTimeout(id);
  }, [reduced, leftX, rightX, vs, fade, onDone]);

  const container = useAnimatedStyle(() => ({ opacity: fade.value }));
  const leftS = useAnimatedStyle(() => ({ transform: [{ translateX: leftX.value }] }));
  const rightS = useAnimatedStyle(() => ({ transform: [{ translateX: rightX.value }] }));
  const vsS = useAnimatedStyle(() => ({ transform: [{ scale: vs.value }], opacity: vs.value }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: 'rgba(2,6,14,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 40 }, container]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={[{ alignItems: 'center' }, leftS]}>
          <Image source={championSprite(playerId)} style={{ width: 96, height: 96, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
          <Text allowFontScaling={false} style={{ fontSize: 9, color: tokens.colors.accent, fontFamily: PIXEL }}>{playerName.toUpperCase()}</Text>
        </Animated.View>
        <Animated.View style={vsS}>
          <Text style={{ fontSize: 40, color: tokens.colors.legendary, textShadowColor: `${tokens.colors.legendary}88`, textShadowRadius: 18, ...pixelFont() }}>VS</Text>
        </Animated.View>
        <Animated.View style={[{ alignItems: 'center' }, rightS]}>
          <Image source={championSprite(opponentId)} style={{ width: 96, height: 96, transform: [{ scaleX: -1 }], ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
          <Text allowFontScaling={false} style={{ fontSize: 9, color: tokens.colors.danger, fontFamily: PIXEL }}>{opponentName.toUpperCase()}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
