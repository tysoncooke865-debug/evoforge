import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { BattleEvent, BattleMode, Combatant } from '@/domain/battle-rpg/types';
import { useThemeColors } from '@/theme/use-theme';

import { CompactHud, FloatingNumber } from './battle-bits';
import { BattleSprite } from './battle-sprite';
import { MoveFxLayer } from './move-fx';

/**
 * THE POKÉMON-POV ARENA (one-screen redesign, Tyson 2026-07-18). Fills
 * whatever height its parent gives it (onLayout-measured for the FX layer).
 * The gym is drawn, not photographed: gradient sky, glowing horizon, a
 * perspective grid floor, spotlight cones and a vignette — all procedural,
 * mode-tinted, zero assets. HUD plates sit INSIDE the arena FireRed-style:
 * opponent top-left, player bottom-right. The container screen-shakes on
 * impacts and white-blinks on crits/ultimates; all motion reduced-gated.
 */
export function BattleArena({
  player,
  opponent,
  mode,
  activeEvent,
  floating,
  winner,
  opponentPower,
}: {
  player: Combatant;
  opponent: Combatant;
  mode: BattleMode;
  activeEvent: BattleEvent | null;
  floating: { side: 'player' | 'opponent'; kind: 'damage' | 'crit' | 'heal'; amount: number; trigger: number } | null;
  winner: 'player' | 'opponent' | null;
  opponentPower?: number;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const shake = useSharedValue(0);
  const blink = useSharedValue(0);
  const zoom = useSharedValue(1);
  // Platform impact flashes — the ground reacts under whoever got hit/healed.
  const oppPlate = useSharedValue(0);
  const plyPlate = useSharedValue(0);
  const [dims, setDims] = useState({ width: 360, height: 300 });
  const { width, height } = dims;

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
    // PUNCH-ZOOM: the camera leans into big moves (deeper for ultimates).
    if (activeEvent.kind === 'move' && heavy) {
      const depth = activeEvent.animationType === 'ultimate' ? 1.05 : 1.028;
      zoom.value = withSequence(withTiming(depth, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 380, easing: Easing.inOut(Easing.quad) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent]);

  useEffect(() => {
    if (!floating || reduced) return;
    const v = floating.side === 'opponent' ? oppPlate : plyPlate;
    v.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating?.trigger]);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }, { scale: zoom.value }] }));
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  const oppPlateStyle = useAnimatedStyle(() => ({ opacity: oppPlate.value }));
  const plyPlateStyle = useAnimatedStyle(() => ({ opacity: plyPlate.value }));
  const plateTint = floating?.kind === 'heal' ? colors.success : '#ff6688';

  const hazeEdge = mode === 'gym' ? '#fb923c' : mode === 'rival' ? '#fb7185' : colors.accent;
  const horizonY = height * 0.46;
  const floorH = height - horizonY;

  // Player sprite scales with the taller arena; opponent stays far/small.
  const pSize = Math.round(Math.min(170, Math.max(128, height * 0.5)));
  const oSize = Math.round(Math.min(120, Math.max(92, height * 0.36)));

  return (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0 && (Math.abs(w - width) > 1 || Math.abs(h - height) > 1)) setDims({ width: w, height: h });
      }}
      style={{ flex: 1, borderRadius: 18, borderWidth: 1, borderColor: `${hazeEdge}33`, overflow: 'hidden', backgroundColor: '#05070f' }}
    >
      <Animated.View style={[{ flex: 1 }, containerStyle]}>
        {/* ---- THE GYM, DRAWN ---- */}
        {/* Sky: deep night wall, mode-tinted toward the horizon. */}
        <LinearGradient
          colors={['#0b1226', '#070b18', `${hazeEdge}30`]}
          locations={[0, 0.7, 1]}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, height: horizonY }}
        />
        {/* Back-wall window strips — faint, high, architectural. */}
        {[0.08, 0.3, 0.52, 0.74].map((x) => (
          <View
            key={x}
            style={{ position: 'absolute', left: width * x, top: horizonY * 0.12, width: width * 0.14, height: horizonY * 0.22, borderRadius: 3, borderWidth: 1, borderColor: `${hazeEdge}14`, backgroundColor: `${hazeEdge}07` }}
          />
        ))}
        {/* Spotlight cones from the top corners. */}
        <LinearGradient colors={[`${hazeEdge}1a`, 'transparent']} style={{ position: 'absolute', left: -width * 0.18, top: -10, width: width * 0.62, height: horizonY * 1.15, transform: [{ rotate: '18deg' }] }} />
        <LinearGradient colors={[`${hazeEdge}14`, 'transparent']} style={{ position: 'absolute', right: -width * 0.18, top: -10, width: width * 0.62, height: horizonY * 1.15, transform: [{ rotate: '-18deg' }] }} />

        {/* Horizon glow line. */}
        <View style={{ position: 'absolute', left: -10, right: -10, top: horizonY - 1, height: 2, backgroundColor: `${hazeEdge}aa`, shadowColor: hazeEdge, shadowOpacity: 0.9, shadowRadius: 10 }} />

        {/* Floor: dark grade falling away from the glow. */}
        <LinearGradient
          colors={[`${hazeEdge}26`, '#080d1a', '#04060d']}
          locations={[0, 0.4, 1]}
          style={{ position: 'absolute', left: 0, right: 0, top: horizonY, height: floorH }}
        />
        {/* Perspective grid: horizontals spread apart as they near the camera… */}
        {[0.1, 0.24, 0.42, 0.66, 0.94].map((f, i) => (
          <View
            key={f}
            style={{ position: 'absolute', left: -10, right: -10, top: horizonY + floorH * f, height: 1, backgroundColor: hazeEdge, opacity: 0.16 - i * 0.02 }}
          />
        ))}
        {/* …and verticals fan out from the vanishing point ON the horizon
            (pivot each line at its TOP: shift half-length up, rotate, back). */}
        {[-64, -38, -14, 14, 38, 64].map((deg) => (
          <View
            key={deg}
            style={{ position: 'absolute', left: width / 2 - 1, top: horizonY, width: 1.5, height: floorH * 2.2, backgroundColor: hazeEdge, opacity: 0.1, transform: [{ translateY: -floorH * 1.1 }, { rotate: `${deg}deg` }, { translateY: floorH * 1.1 }] }}
          />
        ))}

        {/* Vignette — pulls the eye to the fighters. */}
        <LinearGradient colors={['rgba(2,4,10,0.75)', 'transparent']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.2 }} />
        <LinearGradient colors={['transparent', 'rgba(2,4,10,0.8)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.24 }} />

        {/* Opponent — far platform, upper-right, front-facing, smaller. */}
        <View style={{ position: 'absolute', top: height * 0.13, right: 16, alignItems: 'center' }}>
          <View style={{ position: 'absolute', bottom: 2, width: oSize * 0.95, height: oSize * 0.26, borderRadius: 999, borderWidth: 1.5, borderColor: `${hazeEdge}66`, backgroundColor: `${hazeEdge}14`, shadowColor: hazeEdge, shadowOpacity: 0.5, shadowRadius: 12 }} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', bottom: 2, width: oSize * 0.95, height: oSize * 0.26, borderRadius: 999, borderWidth: 2, borderColor: plateTint, backgroundColor: `${plateTint}22` }, oppPlateStyle]} />
          {floating && floating.side === 'opponent' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
          <BattleSprite branch={opponent.spriteBranch} stage={opponent.spriteStage} side="opponent" activeEvent={activeEvent} size={oSize} defeated={winner === 'player'} />
        </View>

        {/* Player — near platform, lower-left, back-facing, bigger. */}
        <View style={{ position: 'absolute', bottom: 6, left: 10, alignItems: 'center' }}>
          <View style={{ position: 'absolute', bottom: 4, width: pSize * 1.02, height: pSize * 0.27, borderRadius: 999, borderWidth: 1.5, borderColor: `${colors.accent}77`, backgroundColor: 'rgba(34,211,238,0.1)', shadowColor: colors.accent, shadowOpacity: 0.55, shadowRadius: 14 }} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', bottom: 4, width: pSize * 1.02, height: pSize * 0.27, borderRadius: 999, borderWidth: 2, borderColor: plateTint, backgroundColor: `${plateTint}22` }, plyPlateStyle]} />
          {floating && floating.side === 'player' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
          <BattleSprite branch={player.spriteBranch} stage={player.spriteStage} side="player" activeEvent={activeEvent} size={pSize} defeated={winner === 'opponent'} victory={winner === 'player'} />
        </View>

        {/* HUD plates INSIDE the arena — FireRed's exact convention. */}
        <View style={{ position: 'absolute', top: 8, left: 8, width: Math.min(190, width * 0.52) }}>
          <CompactHud combatant={opponent} powerLabel={opponentPower} />
        </View>
        <View style={{ position: 'absolute', bottom: 8, right: 8, width: Math.min(190, width * 0.52) }}>
          <CompactHud combatant={player} />
        </View>
      </Animated.View>

      {/* Per-move FX (punches, dumbbell throws, speed blitz, LUNK ALARM…). */}
      <MoveFxLayer
        event={activeEvent}
        height={height}
        width={width}
        playerBranch={player.spriteBranch}
        playerStage={player.spriteStage}
        opponentBranch={opponent.spriteBranch}
        opponentStage={opponent.spriteStage}
      />

      {/* Crit / ultimate white blink over everything. */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' }, blinkStyle]} />
    </View>
  );
}
