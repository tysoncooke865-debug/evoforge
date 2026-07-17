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
  type SharedValue,
} from 'react-native-reanimated';

import type { BattleEvent, SpriteBranch } from '@/domain/battle-rpg/types';
import tokens from '@/theme/tokens';
import { battlePovArt } from './battle-pov-art';

/**
 * MOVE FX v2 (Tyson: "every player needs UNIQUE GYM THEMED animations") —
 * each move is a CHOREOGRAPHED SCENE built from a gym-flavoured primitive
 * vocabulary, staged with delays inside the ~780ms move beat:
 *
 *   projectile   a hand-drawn pixel dumbbell spins across the attack diagonal
 *   drop         a plated barbell falls out of the rig onto the target
 *   ghostDash    the attacker's own sprite afterimages blitz through
 *   slash        glowing cut arcs (size-able for finishers)
 *   strobe       full-arena alarm flashes (THE LUNK ALARM)
 *   stars        punch impact bursts
 *   rise         aura particles over the actor
 *   dome         guard shield bubble
 *   speedlines   full-arena velocity streaks
 *   shockwave    ground rings expanding from an impact (or a breath)
 *   beam         a vertical spotlight column (posing light / finisher mark)
 *   burst        debris out of the impact — weight PLATES, sparks, sweat,
 *                chalk, shreds — each glyph hand-drawn, no assets
 *   orbit        weight plates circle the actor (iron guard)
 *   cracks       the floor splits under a colossal hit
 *   ecg          a heart-rate trace sweeps over the actor (cardio engine)
 *   smoke        chalk-dark puffs (the shadow entrance)
 *   flashbulbs   paparazzi camera pops (the aesthetic showman)
 *   shreds       cut strips flutter off the target
 *   flex         bicep-flex arcs pulse on the actor
 *
 * Still a declarative table — a new move animates by adding a row. Reduced
 * motion renders nothing (the arena's shake/flash collapse there too).
 */

type Prim =
  | { t: 'projectile'; glyph: 'dumbbell'; ms: number; spin?: boolean }
  | { t: 'ghostDash'; ms: number }
  | { t: 'slash'; angles: number[]; color: string; ms: number; delay?: number; size?: number }
  | { t: 'strobe'; color: string; flashes: number; ms: number }
  | { t: 'drop'; glyph: 'barbell'; ms: number }
  | { t: 'stars'; count: number; color: string; ms: number; delay?: number }
  | { t: 'rise'; color: string; count: number; ms: number; glyph?: string }
  | { t: 'dome'; color: string; ms: number }
  | { t: 'speedlines'; color: string; ms: number }
  | { t: 'shockwave'; color: string; ms: number; delay?: number; rings?: number; at?: 'actor' | 'target' }
  | { t: 'beam'; color: string; ms: number; delay?: number; at?: 'actor' | 'target' }
  | { t: 'burst'; glyph: 'plate' | 'spark' | 'sweat' | 'chalk' | 'shred'; color: string; count: number; ms: number; delay?: number }
  | { t: 'orbit'; color: string; count: number; ms: number }
  | { t: 'cracks'; color: string; ms: number; delay?: number }
  | { t: 'ecg'; color: string; ms: number }
  | { t: 'smoke'; count: number; ms: number }
  | { t: 'flashbulbs'; count: number; ms: number; delay?: number }
  | { t: 'shreds'; color: string; count: number; ms: number; delay?: number }
  | { t: 'flex'; color: string; ms: number };

interface MoveFxSpec {
  prims: Prim[];
}

const C = tokens.colors;

export const MOVE_FX: Record<string, MoveFxSpec> = {
  // AESTHETIC — the showman: poses, spotlights, paparazzi.
  precision_strike: {
    prims: [
      { t: 'flex', color: '#ffd166', ms: 240 },
      { t: 'stars', count: 3, color: '#ffd166', ms: 480, delay: 200 },
      { t: 'flashbulbs', count: 3, ms: 460, delay: 280 },
    ],
  },
  perfect_form: {
    prims: [
      { t: 'beam', color: C.epic, ms: 700, at: 'actor' },
      { t: 'rise', color: C.epic, count: 7, ms: 800, glyph: '✦' },
      { t: 'flashbulbs', count: 4, ms: 500, delay: 260 },
    ],
  },
  counter_pose: {
    prims: [
      { t: 'flex', color: C.rare, ms: 300 },
      { t: 'dome', color: C.rare, ms: 700 },
      { t: 'burst', glyph: 'spark', color: C.rare, count: 4, ms: 380, delay: 380 },
    ],
  },
  apex_execution: {
    prims: [
      { t: 'beam', color: C.legendary, ms: 420, at: 'target' },
      { t: 'slash', angles: [-45, 45], color: C.legendary, ms: 380, delay: 240, size: 170 },
      { t: 'burst', glyph: 'spark', color: C.legendary, count: 8, ms: 460, delay: 440 },
      { t: 'shockwave', color: C.legendary, ms: 420, delay: 440 },
    ],
  },
  // TITAN — heavy iron: thrown steel, falling bars, breaking floors.
  forge_smash: {
    prims: [
      { t: 'projectile', glyph: 'dumbbell', ms: 460, spin: true },
      { t: 'shockwave', color: '#ffd166', ms: 420, delay: 400 },
      { t: 'burst', glyph: 'plate', color: '#8fa3bd', count: 4, ms: 500, delay: 420 },
      { t: 'stars', count: 3, color: '#ffd166', ms: 420, delay: 420 },
    ],
  },
  iron_guard: {
    prims: [
      { t: 'orbit', color: '#9fb6d9', count: 4, ms: 760 },
      { t: 'dome', color: '#9fb6d9', ms: 700 },
    ],
  },
  colossal_pressure: {
    prims: [
      { t: 'strobe', color: '#ff3355', flashes: 3, ms: 900 },
      { t: 'beam', color: '#ff3355', ms: 520, delay: 140, at: 'target' },
      { t: 'stars', count: 2, color: '#ff3355', ms: 380, delay: 600 },
    ],
  },
  titan_breaker: {
    prims: [
      { t: 'drop', glyph: 'barbell', ms: 520 },
      { t: 'strobe', color: '#ffffff', flashes: 1, ms: 240 },
      { t: 'cracks', color: '#ffd166', ms: 420, delay: 460 },
      { t: 'shockwave', color: '#ffd166', ms: 480, delay: 450, rings: 2 },
      { t: 'burst', glyph: 'plate', color: '#8fa3bd', count: 6, ms: 540, delay: 480 },
    ],
  },
  // APEX — the cardio engine: afterimages, heart-rate spikes, sonic pace.
  rapid_strike: {
    prims: [
      { t: 'ghostDash', ms: 560 },
      { t: 'stars', count: 2, color: C.accent, ms: 380, delay: 430 },
      { t: 'burst', glyph: 'sweat', color: '#bfe9ff', count: 4, ms: 420, delay: 440 },
    ],
  },
  overclock: {
    prims: [
      { t: 'ecg', color: C.accent, ms: 700 },
      { t: 'rise', color: C.accent, count: 5, ms: 700, glyph: '⚡' },
    ],
  },
  second_wind: {
    prims: [
      { t: 'shockwave', color: C.success, ms: 640, at: 'actor', rings: 2 },
      { t: 'rise', color: C.success, count: 6, ms: 800, glyph: '➰' },
    ],
  },
  velocity_crash: {
    prims: [
      { t: 'speedlines', color: '#dffcff', ms: 620 },
      { t: 'ghostDash', ms: 600 },
      { t: 'strobe', color: '#ffffff', flashes: 1, ms: 200 },
      { t: 'shockwave', color: C.accent, ms: 460, delay: 480, rings: 2 },
      { t: 'burst', glyph: 'spark', color: C.accent, count: 6, ms: 460, delay: 500 },
    ],
  },
  // SHREDDER — the razor: cuts that leave shreds and a bleed.
  twin_slash: {
    prims: [
      { t: 'slash', angles: [-30, 30], color: C.danger, ms: 400 },
      { t: 'burst', glyph: 'sweat', color: '#ff5577', count: 5, ms: 420, delay: 300 },
      { t: 'shreds', color: '#ff8899', count: 4, ms: 520, delay: 320 },
    ],
  },
  shadow_step: {
    prims: [
      { t: 'smoke', count: 5, ms: 640 },
      { t: 'rise', color: '#667', count: 4, ms: 700, glyph: '▓' },
    ],
  },
  cut_deep: {
    prims: [
      { t: 'slash', angles: [-15], color: '#ff5577', ms: 420, size: 160 },
      { t: 'shreds', color: '#ff8899', count: 6, ms: 560, delay: 320 },
      { t: 'burst', glyph: 'spark', color: '#ff5577', count: 3, ms: 400, delay: 340 },
    ],
  },
  final_shred: {
    prims: [
      { t: 'slash', angles: [-60, -20, 20, 60], color: C.legendary, ms: 420, size: 165 },
      { t: 'strobe', color: '#ffffff', flashes: 1, ms: 220 },
      { t: 'shreds', color: C.legendary, count: 8, ms: 600, delay: 400 },
      { t: 'shockwave', color: C.legendary, ms: 420, delay: 430 },
    ],
  },
  // Shared
  recover: { prims: [{ t: 'rise', color: C.success, count: 6, ms: 800, glyph: '＋' }] },
  // Battle items.
  item_protein_shake: {
    prims: [
      { t: 'rise', color: C.success, count: 6, ms: 850, glyph: '🥤' },
      { t: 'burst', glyph: 'sweat', color: '#d8f7e8', count: 4, ms: 460, delay: 300 },
    ],
  },
  item_pre_workout: {
    prims: [
      { t: 'ecg', color: C.epic, ms: 700 },
      { t: 'rise', color: C.epic, count: 6, ms: 850, glyph: '⚡' },
    ],
  },
};

// ---------- hand-drawn pixel props (Views only — no assets) ----------

/** A pixel dumbbell out of plain Views — three-tone shaded, knurled bar. */
function DumbbellGlyph({ size = 34 }: { size?: number }) {
  const plate = (
    <View style={{ width: size * 0.28, height: size * 0.62, backgroundColor: '#8fa3bd', borderRadius: 2, borderWidth: 1, borderColor: '#0b1420', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 1, left: 1, right: 1, height: size * 0.12, backgroundColor: '#c9d8ea', borderRadius: 1 }} />
      <View style={{ position: 'absolute', bottom: 1, left: 1, right: 1, height: size * 0.1, backgroundColor: '#5d7391', borderRadius: 1 }} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {plate}
      <View style={{ width: size * 0.5, height: size * 0.16, backgroundColor: '#c3d2e6', borderWidth: 1, borderColor: '#0b1420', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
        {[0, 1, 2].map((k) => (
          <View key={k} style={{ width: 1, height: size * 0.08, backgroundColor: '#7f93ad' }} />
        ))}
      </View>
      {plate}
    </View>
  );
}

/** A properly plated pixel barbell — shaded plates, knurled bar. */
function BarbellGlyph({ size = 52 }: { size?: number }) {
  const big = (
    <View style={{ width: size * 0.14, height: size * 0.72, backgroundColor: '#8fa3bd', borderRadius: 2, borderWidth: 1, borderColor: '#0b1420', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 1, left: 1, right: 1, height: size * 0.12, backgroundColor: '#c9d8ea' }} />
      <View style={{ position: 'absolute', bottom: 1, left: 1, right: 1, height: size * 0.12, backgroundColor: '#5d7391' }} />
    </View>
  );
  const small = (
    <View style={{ width: size * 0.1, height: size * 0.5, backgroundColor: '#6d82a0', borderRadius: 2, borderWidth: 1, borderColor: '#0b1420', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 1, left: 1, right: 1, height: size * 0.09, backgroundColor: '#a9bcd4' }} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {small}
      {big}
      <View style={{ width: size * 1.1, height: size * 0.12, backgroundColor: '#c3d2e6', borderWidth: 1, borderColor: '#0b1420', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
        {[0, 1, 2, 3, 4].map((k) => (
          <View key={k} style={{ width: 1, height: size * 0.06, backgroundColor: '#7f93ad' }} />
        ))}
      </View>
      {big}
      {small}
    </View>
  );
}

/** A weight plate seen face-on — a ring with a hub hole and a glint. */
function PlateGlyph({ size = 15, color = '#8fa3bd' }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size, borderWidth: size * 0.28, borderColor: color, backgroundColor: '#0b1420' }}>
      <View style={{ position: 'absolute', top: -size * 0.16, left: size * 0.06, width: size * 0.3, height: size * 0.12, borderRadius: size, backgroundColor: '#e6eefb', opacity: 0.85, transform: [{ rotate: '-30deg' }] }} />
    </View>
  );
}

function Star({ color, size }: { color: string; size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size * 0.28, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: 'absolute', width: size * 0.28, height: size, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: 'absolute', width: size * 0.34, height: size * 0.34, borderRadius: size, backgroundColor: '#ffffff', opacity: 0.95 }} />
    </View>
  );
}

// ---------- layout anchors (mirror battle-arena's sprite geometry) ----------

function spriteSizes(height: number) {
  const pSize = Math.round(Math.min(170, Math.max(128, height * 0.5)));
  const oSize = Math.round(Math.min(120, Math.max(92, height * 0.36)));
  return { pSize, oSize };
}

export function MoveFxLayer({
  event,
  height,
  playerBranch,
  playerStage,
  opponentBranch,
  opponentStage,
  width,
}: {
  event: BattleEvent | null;
  height: number;
  playerBranch: SpriteBranch;
  playerStage: number;
  opponentBranch: SpriteBranch;
  opponentStage: number;
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
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {fx.spec.prims.map((p, i) => (
        <PrimView
          key={`${fx.nonce}:${i}`}
          prim={p}
          attacker={fx.attacker}
          height={height}
          width={width}
          attackerBranch={fx.attacker === 'player' ? playerBranch : opponentBranch}
          attackerStage={fx.attacker === 'player' ? playerStage : opponentStage}
        />
      ))}
    </View>
  );
}

function PrimView({
  prim,
  attacker,
  height,
  width,
  attackerBranch,
  attackerStage,
}: {
  prim: Prim;
  attacker: 'player' | 'opponent';
  height: number;
  width: number;
  attackerBranch: SpriteBranch;
  attackerStage: number;
}) {
  // HOOKLESS dispatcher — every leaf owns its own animation hooks, so prim
  // kinds never change hook order (rules-of-hooks safe).
  const targetIsOpponent = attacker === 'player';
  const { pSize, oSize } = spriteSizes(height);

  // Sprite-body anchors (a ~100px box over each fighter).
  const oppBody = { position: 'absolute', top: height * 0.13 + 18, right: 40 } as const;
  const plyBody = { position: 'absolute', top: height - pSize + 6, left: 44 } as const;
  // Ground anchors (platform level, where shockwaves/cracks live).
  const oppGround = { position: 'absolute', top: height * 0.13 + oSize - 14, right: 30 } as const;
  const plyGround = { position: 'absolute', top: height - 52, left: 26 } as const;
  // Beam columns (the full sprite width).
  const oppBeam = { position: 'absolute', top: 0, right: 16, width: oSize } as const;
  const plyBeam = { position: 'absolute', top: 0, left: 10, width: pSize } as const;

  const targetStyle = targetIsOpponent ? oppBody : plyBody;
  const actorStyle = targetIsOpponent ? plyBody : oppBody;
  const targetGround = targetIsOpponent ? oppGround : plyGround;
  const actorGround = targetIsOpponent ? plyGround : oppGround;

  switch (prim.t) {
    case 'projectile': {
      const dx = targetIsOpponent ? width * 0.5 : -width * 0.5;
      const dy = targetIsOpponent ? -(height * 0.42) : height * 0.42;
      return <Thrown ms={prim.ms} dx={dx} dy={dy} spin={Boolean(prim.spin)} origin={actorStyle} />;
    }
    case 'drop': {
      const origin = { ...targetStyle, ...(targetIsOpponent ? { top: -50 } : { top: height - 280 }) };
      return <Dropped ms={prim.ms} origin={origin} fall={targetIsOpponent ? height * 0.13 + 60 : 220} />;
    }
    case 'ghostDash': {
      const pov = attacker === 'player' ? 'back' : 'front';
      const src = battlePovArt(attackerBranch, attackerStage, pov);
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
            <SlashArc key={i} angle={ang} color={prim.color} ms={prim.ms} delayMs={(prim.delay ?? 0) + i * 110} size={prim.size ?? 120} at={targetStyle} />
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
    case 'shockwave': {
      const at = (prim.at ?? 'target') === 'target' ? targetGround : actorGround;
      return (
        <>
          {Array.from({ length: prim.rings ?? 1 }, (_, i) => (
            <ShockRing key={i} idx={i} color={prim.color} ms={prim.ms} delayMs={(prim.delay ?? 0) + i * 120} at={at} />
          ))}
        </>
      );
    }
    case 'beam': {
      const at = (prim.at ?? 'target') === 'target' ? (targetIsOpponent ? oppBeam : plyBeam) : targetIsOpponent ? plyBeam : oppBeam;
      const beamH = at === oppBeam ? height * 0.13 + oSize : height - 20;
      return <BeamCol color={prim.color} ms={prim.ms} delayMs={prim.delay ?? 0} at={at} beamH={beamH} />;
    }
    case 'burst':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <BurstBit key={i} idx={i} count={prim.count} glyph={prim.glyph} color={prim.color} ms={prim.ms} delayMs={prim.delay ?? 0} at={targetStyle} />
          ))}
        </>
      );
    case 'orbit':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <OrbitPlate key={i} idx={i} count={prim.count} color={prim.color} ms={prim.ms} at={actorStyle} />
          ))}
        </>
      );
    case 'cracks':
      return (
        <>
          {[-160, -120, -60, -25, 15].map((ang, i) => (
            <CrackLine key={i} idx={i} angle={ang} color={prim.color} ms={prim.ms} delayMs={prim.delay ?? 0} at={targetGround} />
          ))}
        </>
      );
    case 'ecg':
      return <EcgSweep color={prim.color} ms={prim.ms} at={actorStyle} />;
    case 'smoke':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <SmokePuff key={i} idx={i} ms={prim.ms} at={actorGround} />
          ))}
        </>
      );
    case 'flashbulbs':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <Flashbulb key={i} idx={i} ms={prim.ms} delayMs={prim.delay ?? 0} width={width} height={height} />
          ))}
        </>
      );
    case 'shreds':
      return (
        <>
          {Array.from({ length: prim.count }, (_, i) => (
            <ShredBit key={i} idx={i} color={prim.color} ms={prim.ms} delayMs={prim.delay ?? 0} at={targetStyle} />
          ))}
        </>
      );
    case 'flex':
      return <FlexArcs color={prim.color} ms={prim.ms} at={actorStyle} />;
    default:
      return null;
  }
}

// ---------- leaf animations (each owns its hooks; all one-shot) ----------

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

function Dropped({ ms, origin, fall }: { ms: number; origin: object; fall: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.in(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.92 ? 1 : (1 - t.value) * 12,
    transform: [{ translateY: t.value * fall }, { scale: 0.7 + t.value * 0.5 }],
  }));
  return (
    <Animated.View style={[origin as object, style]}>
      <BarbellGlyph size={52} />
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
      <Image source={src} tintColor="#9fe8ff" style={{ width: 96, height: 96, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
    </Animated.View>
  );
}

function SlashArc({ angle, color, ms, delayMs, size, at }: { angle: number; color: string; ms: number; delayMs: number; size: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.7 ? 0.95 : (1 - t.value) * 3,
    transform: [{ rotate: `${angle}deg` }, { translateX: -size * 0.58 + t.value * size * 1.16 }, { scaleX: 0.4 + t.value * 0.9 }],
  }));
  return (
    <Animated.View style={[at, { width: size, height: 7, borderRadius: 4, backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 10, justifyContent: 'center' }, style]}>
      <View style={{ marginHorizontal: size * 0.12, height: 2.5, borderRadius: 2, backgroundColor: '#ffffff', opacity: 0.9 }} />
    </Animated.View>
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

/** An expanding ground ring — flattened ellipse, impact-plane feel. */
function ShockRing({ idx, color, ms, delayMs, at }: { idx: number; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : (1 - t.value) * (0.9 - idx * 0.25),
    transform: [{ scaleX: 0.25 + t.value * 2 }, { scaleY: (0.25 + t.value * 2) * 0.38 }],
  }));
  return (
    <Animated.View
      style={[at, { width: 86, height: 86, borderRadius: 999, borderWidth: 3, borderColor: color, shadowColor: color, shadowOpacity: 0.8, shadowRadius: 10 }, style]}
    />
  );
}

/** A vertical spotlight column that snaps on and fades. */
function BeamCol({ color, ms, delayMs, at, beamH }: { color: string; ms: number; delayMs: number; at: object; beamH: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.25 ? t.value * 3 : (1 - t.value) * 1.05,
    transform: [{ scaleY: Math.min(1, t.value * 4) }],
  }));
  return (
    <Animated.View style={[at, { height: beamH, borderRadius: 8, backgroundColor: `${color}30`, borderLeftWidth: 2, borderRightWidth: 2, borderColor: `${color}66`, transformOrigin: 'top' as never }, style]} />
  );
}

/** One piece of impact debris — a plate, spark, sweat drop, chalk mote or
 *  shred — flying outward with a gravity arc. Deterministic by idx. */
function BurstBit({ idx, count, glyph, color, ms, delayMs, at }: { idx: number; count: number; glyph: 'plate' | 'spark' | 'sweat' | 'chalk' | 'shred'; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs + (idx % 3) * 40, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ang = (idx / count) * Math.PI * 1.2 - Math.PI * 1.1 + (idx % 2) * 0.3; // fan upward-ish
  const dist = 44 + (idx % 3) * 16;
  const dx = Math.cos(ang) * dist;
  const dy = Math.sin(ang) * dist;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : (1 - t.value) * 1.3,
    transform: [
      { translateX: t.value * dx },
      { translateY: t.value * dy + t.value * t.value * 34 }, // gravity pulls the arc down
      { rotate: `${t.value * (idx % 2 ? 240 : -200)}deg` },
    ],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 34, marginTop: 34 }, style]}>
      {glyph === 'plate' ? (
        <PlateGlyph size={14 + (idx % 3) * 3} color={color} />
      ) : glyph === 'spark' ? (
        <Star color={color} size={11} />
      ) : glyph === 'shred' ? (
        <View style={{ width: 4, height: 13, borderRadius: 1, backgroundColor: color }} />
      ) : glyph === 'chalk' ? (
        <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: `${color}aa` }} />
      ) : (
        <View style={{ width: 5, height: 8, borderRadius: 4, backgroundColor: color }} />
      )}
    </Animated.View>
  );
}

/** Weight plates circling the actor — the iron curtain going up. */
function OrbitPlate({ idx, count, color, ms, at }: { idx: number; count: number; color: string; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.inOut(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const phase = (idx / count) * Math.PI * 2;
  const style = useAnimatedStyle(() => {
    const a = phase + t.value * Math.PI * 2;
    return {
      opacity: t.value === 0 ? 0 : t.value < 0.15 ? t.value * 6 : t.value > 0.85 ? (1 - t.value) * 6 : 1,
      transform: [{ translateX: Math.cos(a) * 52 }, { translateY: Math.sin(a) * 20 }, { scale: 0.8 + Math.sin(a) * 0.2 }],
    };
  });
  return (
    <Animated.View style={[at, { marginLeft: 40, marginTop: 46 }, style]}>
      <PlateGlyph size={17} color={color} />
    </Animated.View>
  );
}

/** The floor splitting under a colossal impact. */
function CrackLine({ idx, angle, color, ms, delayMs, at }: { idx: number; angle: number; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs + idx * 30, withTiming(1, { duration: ms, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const len = 46 + (idx % 3) * 14;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.6 ? 0.85 : (1 - t.value) * 2.1,
    transform: [{ rotate: `${angle}deg` }, { translateX: (-len / 2) * (1 - t.value) }, { scaleX: t.value }],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 36, marginTop: 30, width: len, height: 2.5, borderRadius: 2, backgroundColor: color, shadowColor: color, shadowOpacity: 0.8, shadowRadius: 6 }, style]} />
  );
}

/** A heart-rate trace sweeping across the actor — the engine redlining. */
function EcgSweep({ color, ms, at }: { color: string; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fade = useAnimatedStyle(() => ({ opacity: t.value === 0 ? 0 : t.value < 0.15 ? t.value * 6 : t.value > 0.8 ? (1 - t.value) * 5 : 1 }));
  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 96 }] }));
  // The trace: flat — spike up — spike down — flat, drawn from rotated bars.
  const seg = (left: number, w: number, rot: number, top: number) => (
    <View key={`${left}`} style={{ position: 'absolute', left, top, width: w, height: 2.5, borderRadius: 2, backgroundColor: color, transform: [{ rotate: `${rot}deg` }], opacity: 0.6 }} />
  );
  return (
    <Animated.View style={[at, { marginTop: 34, width: 110, height: 40 }, fade]}>
      {seg(0, 24, 0, 20)}
      {seg(22, 16, -62, 12)}
      {seg(32, 20, 68, 12)}
      {seg(44, 14, -45, 16)}
      {seg(56, 40, 0, 20)}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 16, width: 9, height: 9, borderRadius: 9, backgroundColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 10 }, dot]} />
    </Animated.View>
  );
}

/** Chalk-dark smoke puffs — the shadow entrance. */
function SmokePuff({ idx, ms, at }: { idx: number; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(idx * 70, withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ox = (idx % 3) * 34 - 24;
  const size = 26 + (idx % 3) * 10;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.3 ? t.value * 2.4 : (1 - t.value) * 1.05,
    transform: [{ translateX: ox }, { translateY: -t.value * 34 }, { scale: 0.5 + t.value * 1.1 }],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 20, width: size, height: size, borderRadius: size, backgroundColor: '#2a2f3d' }, style]} />
  );
}

/** A paparazzi camera pop — bright square + star, scattered by idx. */
function Flashbulb({ idx, ms, delayMs, width, height }: { idx: number; ms: number; delayMs: number; width: number; height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs + idx * 110, withTiming(1, { duration: ms, easing: Easing.linear }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const x = ((idx * 137) % 80) / 100 + 0.08; // deterministic scatter
  const y = ((idx * 61) % 45) / 100 + 0.06;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 || t.value === 1 ? 0 : t.value < 0.3 ? t.value * 3.2 : (1 - t.value) * 1.2,
    transform: [{ scale: 0.5 + t.value * 0.9 }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', left: width * x, top: height * y }, style]}>
      <Star color="#ffffff" size={16} />
    </Animated.View>
  );
}

/** A cut strip fluttering off the target. */
function ShredBit({ idx, color, ms, delayMs, at }: { idx: number; color: string; ms: number; delayMs: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delayMs + idx * 45, withTiming(1, { duration: ms, easing: Easing.in(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ox = (idx % 4) * 22 - 22;
  const sway = idx % 2 ? 14 : -14;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : (1 - t.value) * 1.4,
    transform: [
      { translateX: ox + Math.sin(t.value * Math.PI * 2) * sway },
      { translateY: t.value * 74 },
      { rotate: `${t.value * (idx % 2 ? 320 : -280)}deg` },
    ],
  }));
  return (
    <Animated.View style={[at, { marginLeft: 30 + (idx % 3) * 12, marginTop: 30, width: 4, height: 14, borderRadius: 1, backgroundColor: color }, style]} />
  );
}

/** Bicep-flex arcs pulsing on the actor — the pose before the strike. */
function FlexArcs({ color, ms, at }: { color: string; ms: number; at: object }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ms, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <FlexArcHalf t={t} flip={false} color={color} at={at} />
      <FlexArcHalf t={t} flip color={color} at={at} />
    </>
  );
}

function FlexArcHalf({ t, flip, color, at }: { t: SharedValue<number>; flip: boolean; color: string; at: object }) {
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : t.value < 0.4 ? t.value * 2.2 : (1 - t.value) * 1.5,
    transform: [{ scale: 0.75 + t.value * 0.45 }],
  }));
  return (
    <Animated.View
      style={[
        at,
        { marginLeft: flip ? 62 : -8, marginTop: 18, width: 40, height: 40, borderRadius: 40, borderWidth: 4, borderColor: color, borderBottomColor: 'transparent', borderLeftColor: flip ? 'transparent' : color, borderRightColor: flip ? color : 'transparent', shadowColor: color, shadowOpacity: 0.8, shadowRadius: 8 },
        style,
      ]}
    />
  );
}
