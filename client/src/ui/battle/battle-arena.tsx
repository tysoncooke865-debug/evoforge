import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { BattleEvent, BattleMode, Combatant } from '@/domain/battle-rpg/types';
import { useThemeColors } from '@/theme/use-theme';

import { BattleSprite } from './battle-sprite';
import { MoveFxLayer } from './move-fx';
import { FloatingNumber } from './battle-bits';

/**
 * THE POKÉMON-POV ARENA. Depth is faked with two elliptical platforms — the
 * player's near/wide/low, the opponent's far/small/high — a perspective floor
 * and a mode-tinted haze. The whole container SCREEN-SHAKES on impacts and
 * WHITE-BLINKS on crits/ultimates. All motion is reduced-motion gated.
 */
export function BattleArena({
  player,
  opponent,
  mode,
  activeEvent,
  floating,
  winner,
  height = 240,
}: {
  player: Combatant;
  opponent: Combatant;
  mode: BattleMode;
  activeEvent: BattleEvent | null;
  floating: { side: 'player' | 'opponent'; kind: 'damage' | 'crit' | 'heal'; amount: number; trigger: number } | null;
  winner: 'player' | 'opponent' | null;
  height?: number;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const shake = useSharedValue(0);
  const blink = useSharedValue(0);

  useEffect(() => {
    if (!activeEvent || reduced) return;
    const heavy = activeEvent.animationType === 'ultimate' || activeEvent.animationType === 'heavy';
    if (activeEvent.kind === 'damage' || activeEvent.kind === 'crit') {
      const mag = activeEvent.kind === 'crit' ? 9 : heavy ? 7 : 4;
      shake.value = withSequence(
        withTiming(-mag, { duration: 45 }), withTiming(mag, { duration: 45 }),
        withTiming(-mag * 0.5, { duration: 45 }), withTiming(0, { duration: 55 })
      );
    }
    if (activeEvent.kind === 'crit' || (activeEvent.kind === 'move' && activeEvent.animationType === 'ultimate')) {
      blink.value = withSequence(withTiming(0.55, { duration: 60 }), withTiming(0, { duration: 300 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent]);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const haze =
    mode === 'gym' ? 'rgba(251,146,60,0.10)' : mode === 'rival' ? 'rgba(251,113,133,0.08)' : 'rgba(34,211,238,0.07)';
  const hazeEdge = mode === 'gym' ? '#fb923c' : mode === 'rival' ? '#fb7185' : colors.accent;

  return (
    <View style={{ height, borderRadius: 16, borderWidth: 1, borderColor: `${colors.accent}22`, overflow: 'hidden', backgroundColor: colors['bg-deep'] }}>
      <Animated.View style={[{ flex: 1 }, containerStyle]}>
        {/* Backdrop haze. */}
        <LinearGradient colors={['rgba(4,7,14,0)', haze, 'rgba(4,7,14,0.55)']} style={{ position: 'absolute', inset: 0 }} />
        {/* Perspective floor line. */}
        <View style={{ position: 'absolute', left: -20, right: -20, top: height * 0.44, height: 1, backgroundColor: `${hazeEdge}22` }} />

        {/* Opponent — far platform, upper-right, front-facing, smaller. */}
        <View style={{ position: 'absolute', top: 12, right: 22, alignItems: 'center' }}>
          <View style={{ position: 'absolute', bottom: 6, width: 92, height: 26, borderRadius: 999, borderWidth: 1, borderColor: `${hazeEdge}55`, backgroundColor: `${hazeEdge}12` }} />
          {floating && floating.side === 'opponent' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
          <BattleSprite branch={opponent.spriteBranch} stage={opponent.spriteStage} side="opponent" activeEvent={activeEvent} size={104} defeated={winner === 'player'} />
        </View>

        {/* Player — near platform, lower-left, back-facing, bigger. */}
        <View style={{ position: 'absolute', bottom: 4, left: 14, alignItems: 'center' }}>
          <View style={{ position: 'absolute', bottom: 8, width: 150, height: 40, borderRadius: 999, borderWidth: 1, borderColor: `${colors.accent}66`, backgroundColor: 'rgba(34,211,238,0.08)' }} />
          {floating && floating.side === 'player' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
          <BattleSprite branch={player.spriteBranch} stage={player.spriteStage} side="player" activeEvent={activeEvent} size={148} defeated={winner === 'opponent'} victory={winner === 'player'} />
        </View>
      </Animated.View>

      {/* Per-move FX (punches, dumbbell throws, speed blitz, LUNK ALARM…). */}
      <MoveFxLayer event={activeEvent} height={height} width={360} playerBranch={player.spriteBranch} playerStage={player.spriteStage} />

      {/* Crit / ultimate white blink over everything. */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: '#fff' }, blinkStyle]} />
    </View>
  );
}
