import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { BattleEvent, SpriteBranch } from '@/domain/battle-rpg/types';
import tokens from '@/theme/tokens';
import { battlePovArt } from './battle-pov-art';

/**
 * MOVE FX (Tyson, 2026-07-18: "punching, throwing a dumbbell, speed blitz,
 * LUNK ALARM…") — every move gets a UNIQUE, gym-flavoured animation, driven by
 * a declarative table over a small set of primitives. Data, not one-offs: a
 * new move animates by adding a row. Reduced motion renders nothing (the
 * arena's shake/flash already collapse there too).
 *
 * Primitives: projectile (a hand-drawn pixel dumbbell/bar travels the attack
 * diagonal), ghostDash (the attacker's own sprite afterimages blitz through),
 * slash (angled arcs), strobe (full-arena alarm flashes), drop (a barbell
 * falls on the target), stars (punch impact bursts), rise (aura particles),
 * dome (guard shield), speedlines.
 */

type Prim =
  | { t: 'projectile'; glyph: 'dumbbell' | 'plate'; ms: number; spin?: boolean }
  | { t: 'ghostDash'; ms: number }
  | { t: 'slash'; angles: number[]; color: string; ms: number; delay?: number }
  | { t: 'strobe'; color: string; flashes: number; ms: number }
  | { t: 'drop'; glyph: 'barbell'; ms: number }
  | { t: 'stars'; count: number; color: string; ms: number; delay?: number }
  | { t: 'rise'; color: string; count: number; ms: number; glyph?: string }
  | { t: 'dome'; color: string; ms: number }
  | { t: 'speedlines'; color: string; ms: number };

interface MoveFxSpec {
  prims: Prim[];
}

const C = tokens.colors;

export const MOVE_FX: Record<string, MoveFxSpec> = {
  // AESTHETIC — technique and poise
  precision_strike: { prims: [{ t: 'stars', count: 3, color: '#ffd166', ms: 520, delay: 120 }] }, // the punch combo
  perfect_form: { prims: [{ t: 'rise', color: C.epic, count: 7, ms: 800, glyph: '✦' }] },
  counter_pose: { prims: [{ t: 'dome', color: C.rare, ms: 700 }] },
  apex_execution: { prims: [{ t: 'drop', glyph: 'barbell', ms: 620 }, { t: 'stars', count: 5, color: C.legendary, ms: 500, delay: 480 }] },
  // TITAN — iron and mass
  forge_smash: { prims: [{ t: 'projectile', glyph: 'dumbbell', ms: 480, spin: true }, { t: 'stars', count: 4, color: '#ffd166', ms: 480, delay: 420 }] }, // THE DUMBBELL THROW
  iron_guard: { prims: [{ t: 'dome', color: '#9fb6d9', ms: 700 }] },
  colossal_pressure: { prims: [{ t: 'strobe', color: '#ff3355', flashes: 3, ms: 900 }, { t: 'stars', count: 2, color: '#ff3355', ms: 400, delay: 600 }] }, // THE LUNK ALARM
  titan_breaker: { prims: [{ t: 'drop', glyph: 'barbell', ms: 560 }, { t: 'strobe', color: '#ffffff', flashes: 1, ms: 260 }, { t: 'stars', count: 6, color: C.legendary, ms: 560, delay: 460 }] },
  // APEX — tempo
  rapid_strike: { prims: [{ t: 'ghostDash', ms: 560 }] }, // THE SPEED BLITZ
  overclock: { prims: [{ t: 'rise', color: C.accent, count: 6, ms: 700, glyph: '⚡' }] },
  second_wind: { prims: [{ t: 'rise', color: C.success, count: 6, ms: 800, glyph: '➰' }] },
  velocity_crash: { prims: [{ t: 'speedlines', color: '#dffcff', ms: 620 }, { t: 'ghostDash', ms: 620 }, { t: 'stars', count: 5, color: C.accent, ms: 500, delay: 520 }] },
  // SHREDDER — blades
  twin_slash: { prims: [{ t: 'slash', angles: [-30, 30], color: C.danger, ms: 420 }] },
  shadow_step: { prims: [{ t: 'rise', color: '#556', count: 5, ms: 700, glyph: '▓' }] },
  cut_deep: { prims: [{ t: 'slash', angles: [-15], color: '#ff5577', ms: 460 }, { t: 'stars', count: 2, color: '#ff5577', ms: 400, delay: 360 }] },
  final_shred: { prims: [{ t: 'slash', angles: [-45, 45], color: C.legendary, ms: 520 }, { t: 'strobe', color: '#ffffff', flashes: 1, ms: 240 }, { t: 'stars', count: 6, color: C.legendary, ms: 520, delay: 420 }] },
  // Shared
  recover: { prims: [{ t: 'rise', color: C.success, count: 6, ms: 800, glyph: '＋' }] },
};

/** A hand-drawn pixel dumbbell/barbell out of plain Views (no assets). */
function DumbbellGlyph({ size = 34, bar = false }: { size?: number; bar?: boolean }) {
  const plate = { width: size * 0.28, height: size * (bar ? 0.9 : 0.62), backgroundColor: '#8fa3bd', borderRadius: 2, borderWidth: 1, borderColor: '#0b1420' } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={plate} />
      <View style={{ width: size * (bar ? 1.4 : 0.5), height: size * 0.16, backgroundColor: '#c3d2e6', borderWidth: 1, borderColor: '#0b1420' }} />
      <View style={plate} />
    </View>
  );
}

function Star({ color, size }: { color: string; size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size * 0.28, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: 'absolute', width: size * 0.28, height: size, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

/** Where things happen, mirroring battle-arena's layout constants. */
function anchors(height: number, attacker: 'player' | 'opponent') {
  const opp = { x: 76, y: 64 }; // centre-ish of the opponent sprite (from right/top)
  const ply = { x: 88, y: height - 80 }; // centre-ish of the player sprite (from left/bottom→abs)
  return attacker === 'player'
    ? { from: { left: ply.x, top: ply.y }, to: { rightAnchor: true, left: undefined, x: opp.x, top: opp.y } }
    : { from: { left: undefined, rightAnchor: true, x: opp.x, top: opp.y }, to: { left: ply.x, top: ply.y } };
}

export function MoveFxLayer({
  event,
  height,
  playerBranch,
  playerStage,
  width,
}: {
  event: BattleEvent | null;
  height: number;
  playerBranch: SpriteBranch;
  playerStage: number;
  width: number;
}) {
  const reduced = useReducedMotion();
  const [fx, setFx] = useState<{ spec: MoveFxSpec; attacker: 'player' | 'opponent'; nonce: number } | null>(null);
  // Render-time derived state (the repo's set-state-in-effect rule): a new
  // move event swaps the active FX in place.
  const [prevEvent, setPrevEvent] = useState<BattleEvent | null>(null);
  if (event !== prevEvent) {
    setPrevEvent(event);
    if (!reduced && event?.kind === 'move' && event.moveId && MOVE_FX[event.moveId]) {
      setFx((old) => ({ spec: MOVE_FX[event.moveId as string], attacker: event.side, nonce: (old?.nonce ?? 0) + 1 }));
    }
  }

  if (!fx) return null;
  const a = anchors(height, fx.attacker);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {fx.spec.prims.map((p, i) => (
        <PrimView key={`${fx.nonce}:${i}`} prim={p} attacker={fx.attacker} height={height} width={width} anchors={a} playerBranch={playerBranch} playerStage={playerStage} />
      ))}
    </View>
  );
}

function PrimView({
  prim,
  attacker,
  height,
  width,
  playerBranch,
  playerStage,
}: {
  prim: Prim;
  attacker: 'player' | 'opponent';
  height: number;
  width: number;
  anchors: ReturnType<typeof anchors>;
  playerBranch: SpriteBranch;
  playerStage: number;
}) {
  // HOOKLESS dispatcher — every leaf owns its own animation hooks, so prim
  // kinds never change hook order (rules-of-hooks safe).
  const targetIsOpponent = attacker === 'player';
  const targetStyle = targetIsOpponent
    ? ({ position: 'absolute', top: 30, right: 40 } as const)
    : ({ position: 'absolute', top: height - 150, left: 44 } as const);
  const actorStyle = targetIsOpponent
    ? ({ position: 'absolute', top: height - 150, left: 44 } as const)
    : ({ position: 'absolute', top: 30, right: 40 } as const);

  switch (prim.t) {
    case 'projectile': {
      const dx = targetIsOpponent ? width * 0.5 : -width * 0.5;
      const dy = targetIsOpponent ? -(height * 0.42) : height * 0.42;
      return <Thrown ms={prim.ms} dx={dx} dy={dy} spin={Boolean(prim.spin)} origin={actorStyle} />;
    }
    case 'drop': {
      const origin = { ...targetStyle, ...(targetIsOpponent ? { top: -40 } : { top: height - 260 }) };
      return <Dropped ms={prim.ms} origin={origin} />;
    }
    case 'ghostDash': {
      const pov = attacker === 'player' ? 'back' : 'front';
      const src = battlePovArt(playerBranch, playerStage, pov);
      const dx = targetIsOpponent ? width * 0.55 : -width * 0.55;
      const dy = targetIsOpponent ? -(height * 0.4) : height * 0.4;
      return (
        <>
          {[0, 1, 2].map((g) => (
            <Ghost key={g} idx={g} src={src} dx={dx} dy={dy} ms={prim.ms} origin={actorStyle} />
          ))}
        </>
      );
    }
    case 'slash':
      return (
        <>
          {prim.angles.map((ang, i) => (
            <SlashArc key={i} angle={ang} color={prim.color} ms={prim.ms} delayMs={(prim.delay ?? 0) + i * 120} at={targetStyle} />
          ))}
        </>
      );
    case 'strobe':
      return <Strobe color={prim.color} flashes={prim.flashes} ms={prim.ms} />;
    case 'stars':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <ImpactStar key={i} idx={i} color={prim.color} ms={prim.ms} delayMs={(prim.delay ?? 0) + i * 70} at={targetStyle} />
          ))}
        </>
      );
    case 'rise':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <RiseParticle key={i} idx={i} color={prim.color} glyph={prim.glyph ?? '✦'} ms={prim.ms} at={actorStyle} />
          ))}
        </>
      );
    case 'dome':
      return <Dome color={prim.color} ms={prim.ms} at={actorStyle} />;
    case 'speedlines':
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <SpeedLine key={i} idx={i} color={prim.color} ms={prim.ms} width={width} height={height} />
          ))}
        </>
      );
    default:
      return null;
  }
}

function Thrown({ ms, dx, dy, spin, origin }: { ms: number; dx: number; dy: number; spin: boolean; origin: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.92 ? 1 : (1 - t.value) * 12,
    transform: [{ translateX: t.value * dx }, { translateY: t.value * dy }, { rotate: `${t.value * (spin ? 720 : 0)}deg` }],
  }));
  return (
    <Animated.View style={[origin as object, style]}>
      <DumbbellGlyph size={34} />
    </Animated.View>
  );
}

function Dropped({ ms, origin }: { ms: number; origin: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.in(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.92 ? 1 : (1 - t.value) * 12,
    transform: [{ translateY: -140 + t.value * 140 }, { scale: 0.7 + t.value * 0.6 }],
  }));
  return (
    <Animated.View style={[origin as object, style]}>
      <DumbbellGlyph size={46} bar />
    </Animated.View>
  );
}

function Strobe({ color, flashes, ms }: { color: string; flashes: number; ms: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value > 0 && t.value < 1 ? (Math.sin(t.value * Math.PI * flashes * 2) > 0 ? 0.32 : 0) : 0,
  }));
  return <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color }, style]} />;
}

function Dome({ color, ms, at }: { color: string; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.2 ? t.value * 4 : (1 - t.value) * 1.1,
    transform: [{ scale: 0.6 + t.value * 0.5 }],
  }));
  return (
    <Animated.View
      style={[at, { width: 130, height: 130, marginLeft: -20, marginTop: -10, borderRadius: 999, borderWidth: 3, borderColor: color, backgroundColor: `${color}18` }, style]}
    />
  );
}

function Ghost({ idx, src, dx, dy, ms, origin }: { idx: number; src: ReturnType<typeof battlePovArt>; dx: number; dy: number; ms: number; origin: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(idx * 90, withTiming(1, { duration: ms, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : (1 - t.value) * (0.75 - idx * 0.2),
    transform: [{ translateX: t.value * dx }, { translateY: t.value * dy }],
  }));
  return (
    <Animated.View style={[origin as object, style]}>
      <Image source={src} style={{ width: 96, height: 96, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
    </Animated.View>
  );
}

function SlashArc({ angle, color, ms, delayMs, at }: { angle: number; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.7 ? 0.95 : (1 - t.value) * 3,
    transform: [{ rotate: `${angle}deg` }, { translateX: -70 + t.value * 140 }, { scaleX: 0.4 + t.value * 0.9 }],
  }));
  return (
    <Animated.View style={[at, { width: 120, height: 7, borderRadius: 4, backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 10 }, style]} />
  );
}

function ImpactStar({ idx, color, ms, delayMs, at }: { idx: number; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ox = (idx % 3) * 26 - 26;
  const oy = Math.floor(idx / 3) * 22 - 8 + (idx % 2) * 14;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : (1 - t.value) * 1.2,
    transform: [{ translateX: ox * t.value * 1.6 }, { translateY: oy * t.value * 1.6 }, { scale: 0.3 + t.value * 1.1 }, { rotate: `${t.value * 90}deg` }],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 24, marginTop: 24 }, style]}>
      <Star color={color} size={18} />
    </Animated.View>
  );
}

function RiseParticle({ idx, color, glyph, ms, at }: { idx: number; color: string; glyph: string; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(idx * 80, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ox = (idx % 3) * 30 - 20;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.6 ? 0.95 : (1 - t.value) * 2.4,
    transform: [{ translateX: ox }, { translateY: 30 - t.value * 84 }, { scale: 0.7 + t.value * 0.5 }],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 30 }, style]}>
      <Text style={{ fontSize: 16, color, textShadowColor: color, textShadowRadius: 8 }}>{glyph}</Text>
    </Animated.View>
  );
}

function SpeedLine({ idx, color, ms, width, height }: { idx: number; color: string; ms: number; width: number; height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: ms / 2, easing: Easing.linear }), 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const y = (height / 7) * (idx + 0.5);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : 0.5 - Math.abs(0.5 - t.value) * 0.6,
    transform: [{ translateX: -width + t.value * width * 2.4 }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: y, left: 0, width: width * 0.7, height: 2.5, borderRadius: 2, backgroundColor: color }, style]} />
  );
}
