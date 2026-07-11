/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated in effects/press handlers by design; see neon-button.tsx. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { BattleParticipant } from '@/data/battle/hooks';
import { type BranchV2 } from '@/domain/branches-v2';
import tokens from '@/theme/tokens';
import { avatarArtV2, battleBackArtV2 } from '@/ui/avatar-art';
import { ParticleLayer } from '@/ui/particle-layer';
import { Silhouette } from '@/ui/silhouette';

/**
 * The FACE OFF scene: one integrated cyberpunk arena, not stacked cards.
 * Layered back-to-front — stadium light, crowd, fog, perspective floor,
 * holographic platforms, the two athletes breathing on them, HUD panels
 * hovering above, the VS burning in the middle. Every loop is gated by
 * reduced motion; every animated node carries inline styles only.
 */

const CYAN = tokens.colors.accent;
const PURPLE = tokens.colors.epic;

// Deterministic crowd bumps (no randomness in render — the compiler lint
// is right that render must be pure).
const CROWD: readonly { w: number; h: number; o: number }[] = [
  { w: 16, h: 9, o: 0.5 }, { w: 12, h: 7, o: 0.35 }, { w: 18, h: 10, o: 0.45 },
  { w: 13, h: 8, o: 0.3 }, { w: 17, h: 9, o: 0.5 }, { w: 11, h: 7, o: 0.4 },
  { w: 15, h: 10, o: 0.35 }, { w: 19, h: 8, o: 0.45 }, { w: 12, h: 9, o: 0.3 },
  { w: 16, h: 7, o: 0.5 }, { w: 14, h: 10, o: 0.4 }, { w: 18, h: 8, o: 0.35 },
  { w: 12, h: 9, o: 0.45 }, { w: 15, h: 7, o: 0.3 },
];

function CrowdStrip({ top, flip }: { top: number; flip?: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: 14,
        flexDirection: flip ? 'row-reverse' : 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
        alignItems: 'flex-end',
        opacity: 0.16,
      }}
    >
      {CROWD.map((c, i) => (
        <View
          key={i}
          style={{
            width: c.w,
            height: c.h,
            borderTopLeftRadius: c.w / 2,
            borderTopRightRadius: c.w / 2,
            backgroundColor: `rgba(120,170,220,${c.o})`,
          }}
        />
      ))}
    </View>
  );
}

/** A flickering shaft of stadium light. */
function LightRay({ left, tint, angle, delay }: { left: `${number}%`; tint: string; angle: string; delay: number }) {
  const reducedMotion = useReducedMotion();
  const o = useSharedValue(0.05);
  useEffect(() => {
    if (reducedMotion) return;
    o.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.11, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.04, { duration: 3100, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: -30, left, width: 70, height: 300, transform: [{ rotate: angle }] },
        style,
      ]}
    >
      <LinearGradient
        colors={[`${tint}90`, `${tint}00`]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

/** Drifting floor fog. */
function FogBank({ bottom, tint, delay }: { bottom: number; tint: string; delay: number }) {
  const reducedMotion = useReducedMotion();
  const x = useSharedValue(-24);
  useEffect(() => {
    if (reducedMotion) return;
    x.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(24, { duration: 7000, easing: Easing.inOut(Easing.quad) }),
          withTiming(-24, { duration: 7000, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', bottom, left: -40, right: -40, height: 44 }, style]}>
      <LinearGradient
        colors={[`${tint}00`, `${tint}14`, `${tint}00`]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1, borderRadius: 22 }}
      />
    </Animated.View>
  );
}

/** Perspective lines converging toward the VS. */
function FloorLines() {
  const lines: { side: 'left' | 'right'; bottom: number; rot: number; tint: string }[] = [
    { side: 'left', bottom: 18, rot: -16, tint: CYAN },
    { side: 'left', bottom: 44, rot: -9, tint: CYAN },
    { side: 'left', bottom: 70, rot: -4, tint: CYAN },
    { side: 'right', bottom: 18, rot: 16, tint: PURPLE },
    { side: 'right', bottom: 44, rot: 9, tint: PURPLE },
    { side: 'right', bottom: 70, rot: 4, tint: PURPLE },
  ];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 }}>
      {lines.map((l, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            bottom: l.bottom,
            [l.side]: -20,
            width: '58%',
            transform: [{ rotate: `${l.rot}deg` }],
          }}
        >
          <LinearGradient
            colors={l.side === 'left' ? [`${l.tint}3d`, `${l.tint}00`] : [`${l.tint}00`, `${l.tint}3d`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ height: 1.5 }}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * The floating tournament platform: metallic deck, holographic inner
 * surface, an outer ring with energy racing around it, hovering above its
 * own shadow with light spilling onto the arena floor beneath.
 */
function PlatformStage({ tint }: { tint: string }) {
  const reducedMotion = useReducedMotion();
  const orbit = useSharedValue(0);
  const shimmer = useSharedValue(0.6);
  useEffect(() => {
    if (reducedMotion) return;
    orbit.value = withRepeat(withTiming(360, { duration: 3800, easing: Easing.linear }), -1);
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.6, { duration: 1700, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  // The energy mote rides a circle that scaleY compresses into the ring's ellipse.
  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 44 / 164 }, { rotate: `${orbit.value}deg` }],
  }));
  const holo = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <View style={{ width: 170, height: 92, alignItems: 'center' }}>
      {/* light pool + drop shadow on the arena floor */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, width: 150, height: 22, borderRadius: 999, backgroundColor: `${tint}17`, shadowColor: tint, shadowOpacity: 0.55, shadowRadius: 26 }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 3, width: 112, height: 14, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' }} />

      {/* the hovering assembly */}
      <View style={{ position: 'absolute', bottom: 28, alignItems: 'center' }}>
        {/* under-hull glow bleeding downward */}
        <LinearGradient
          colors={[`${tint}38`, `${tint}00`]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', top: 26, width: 96, height: 26, borderRadius: 14, opacity: 0.8 }}
        />
        {/* hull depth */}
        <View style={{ position: 'absolute', top: 9, width: 140, height: 34, borderRadius: 999, backgroundColor: '#060c18', borderWidth: 1, borderColor: 'rgba(120,170,220,0.18)' }} />
        {/* metallic deck */}
        <View style={{ width: 140, height: 34, borderRadius: 999, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(150,190,235,0.4)' }}>
          <LinearGradient
            colors={['#2a3d61', '#152238', '#0a1322']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ flex: 1 }}
          />
        </View>
        {/* holographic surface */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 5,
              width: 110,
              height: 22,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: `${tint}8c`,
              backgroundColor: `${tint}21`,
              shadowColor: tint,
              shadowOpacity: 0.7,
              shadowRadius: 12,
            },
            holo,
          ]}
        />
        {/* outer holo ring + racing energy */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -5, width: 164, height: 44, borderRadius: 999, borderWidth: 1.5, borderColor: `${tint}59` }} />
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: -65, width: 164, height: 164, alignItems: 'flex-end', justifyContent: 'center' },
            orbitStyle,
          ]}
        >
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tint, shadowColor: tint, shadowOpacity: 1, shadowRadius: 10 }} />
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * An athlete ON their platform: the whole unit hovers together so the feet
 * stay anchored. LEFT is the back-sprite looking across the arena (the
 * Pokémon staging); RIGHT is the front art angled inward toward the fight.
 */
function Fighter({ p, tint, side }: { p: BattleParticipant | null; tint: string; side: 'left' | 'right' }) {
  const reducedMotion = useReducedMotion();
  const hover = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    hover.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2800, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const unit = useAnimatedStyle(() => ({ transform: [{ translateY: -hover.value * 4 }] }));
  const aura = useAnimatedStyle(() => ({ opacity: 0.2 + hover.value * 0.2 }));

  const snap = p?.snapshot ?? {};
  const branch = (snap.branch ?? 'aesthetic') as BranchV2;
  const sex = snap.sex === 'female' ? 'female' as const : 'male' as const;
  const stage = typeof snap.stage === 'number' ? snap.stage : 1;
  const back = battleBackArtV2(branch, sex, side);
  const art = avatarArtV2(branch, stage, sex);
  const donor = branch === 'titan' ? 'mass' : branch === 'cardio' ? 'hybrid' : branch === 'shredder' ? 'aesthetic' : branch;

  // Battle sprites already face the fight; front-art fallbacks turn inward
  // with a perspective twist instead.
  const inward = back
    ? undefined
    : { transform: [{ perspective: 700 }, { rotateY: side === 'right' ? '-18deg' : '18deg' }] };

  return (
    <Animated.View style={[{ alignItems: 'center', width: 170 }, unit]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            bottom: 44,
            width: 118,
            height: 156,
            borderRadius: 70,
            backgroundColor: `${tint}1c`,
            shadowColor: tint,
            shadowOpacity: 0.7,
            shadowRadius: 34,
          },
          aura,
        ]}
      />
      {/* feet planted on the deck: the sprite overlaps the platform top */}
      <View style={{ marginBottom: back ? -84 : -78, zIndex: 2 }}>
        {back ? (
          // Native ratios: left 443×640, right 290×640. The left sprite's
          // wide stance eats canvas height, so the upright right sprite
          // renders shorter to put both athletes at the same eye level.
          <Image source={back} style={side === 'left' ? { width: 121, height: 175 } : { width: 73, height: 161 }} contentFit="contain" />
        ) : art.hasArt ? (
          <View style={inward}>
            <Image source={art.source} style={{ width: 148, height: 163 }} contentFit="contain" />
          </View>
        ) : (
          <View style={inward}>
            <Silhouette branch={donor as 'aesthetic' | 'mass' | 'hybrid'} stage={Math.min(stage, 4)} rim={tint} />
          </View>
        )}
      </View>
      <PlatformStage tint={tint} />
    </Animated.View>
  );
}

/** The cyber HUD panel hovering above a fighter. */
function HudPanel({ p, tint, align }: { p: BattleParticipant | null; tint: string; align: 'left' | 'right' }) {
  const reducedMotion = useReducedMotion();
  const float = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2300, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2300, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateY: float.value * -2 }] }));

  const snap = p?.snapshot ?? {};
  return (
    <Animated.View style={[{ flex: 1 }, drift]}>
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: `${tint}4d`,
          backgroundColor: 'rgba(6,12,24,0.55)',
          paddingVertical: 8,
          paddingHorizontal: 10,
          shadowColor: tint,
          shadowOpacity: 0.3,
          shadowRadius: 14,
          elevation: 4,
        }}
      >
        {/* team accent + corner ticks: HUD, not a card */}
        <LinearGradient
          colors={align === 'left' ? [tint, `${tint}00`] : [`${tint}00`, tint]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ position: 'absolute', top: 0, left: 8, right: 8, height: 1.5, borderRadius: 1 }}
        />
        {([{ top: -1, [align]: -1, borderTopWidth: 2 }, { bottom: -1, [align]: -1, borderBottomWidth: 2 }] as const).map(
          (corner, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 12,
                height: 12,
                borderColor: `${tint}cc`,
                ...(align === 'left' ? { borderLeftWidth: 2 } : { borderRightWidth: 2 }),
                ...corner,
              }}
            />
          )
        )}
        <Text
          className="text-sm font-bold text-text"
          numberOfLines={1}
          style={{ textAlign: align, letterSpacing: 0.5 }}
        >
          {snap.name ?? '???'}
        </Text>
        <Text className="text-2xs text-text-mute" style={{ textAlign: align }}>
          <Text style={{ color: tint, fontWeight: '800' }}>LV {snap.level ?? '?'}</Text>
          {' · '}PWR {snap.power ?? '?'}
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1} style={{ textAlign: align }}>
          {snap.characterClass ?? ''}
        </Text>
      </View>
    </Animated.View>
  );
}

/** The cinematic VS: bloom, pulse, a light streak crossing behind it. */
function CinematicVS() {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  const streak = useSharedValue(-1);
  useEffect(() => {
    if (reducedMotion) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    streak.value = withRepeat(
      withSequence(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.cubic) }), withTiming(-1, { duration: 0 })),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const vsStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.07 }] }));
  const streakStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: streak.value * 130 }],
    opacity: 0.75 - Math.abs(streak.value) * 0.6,
  }));

  return (
    <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          { position: 'absolute', width: 220, height: 2 },
          streakStyle,
        ]}
      >
        <LinearGradient
          colors={[`${PURPLE}00`, '#ffffffcc', `${PURPLE}00`]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <Animated.View style={vsStyle}>
        <Text
          style={{
            fontSize: 54,
            fontWeight: '900',
            fontStyle: 'italic',
            letterSpacing: 3,
            color: PURPLE,
            textShadowColor: 'rgba(168,85,247,0.9)',
            textShadowRadius: 28,
          }}
        >
          VS
        </Text>
      </Animated.View>
    </View>
  );
}

/** The whole arena. Heroes first; everything else is set dressing. */
export function FaceOffScene({ me, them }: { me: BattleParticipant | null; them: BattleParticipant | null }) {
  return (
    <View
      style={{
        height: 440,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: '#04070f',
      }}
    >
      {/* stadium light */}
      <LinearGradient
        colors={['#0a1428', '#04070f', '#02040a']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: -70, left: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: `${CYAN}12` }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -70, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: `${PURPLE}12` }} />
      <LightRay left="6%" tint={CYAN} angle="14deg" delay={0} />
      <LightRay left="30%" tint={CYAN} angle="6deg" delay={1300} />
      <LightRay left="58%" tint={PURPLE} angle="-6deg" delay={700} />
      <LightRay left="82%" tint={PURPLE} angle="-14deg" delay={2000} />
      <CrowdStrip top={116} />
      <CrowdStrip top={132} flip />
      <View pointerEvents="none" style={{ position: 'absolute', top: 148, left: 0, right: 0, height: 1, backgroundColor: 'rgba(120,170,220,0.14)' }} />
      <FloorLines />
      <FogBank bottom={26} tint={CYAN} delay={0} />
      <FogBank bottom={54} tint={PURPLE} delay={2400} />

      {/* the two athletes light their own arena */}
      <ParticleLayer colour={CYAN} height={300} />
      <ParticleLayer colour={PURPLE} height={260} />

      <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 14 }}>
        <View style={{ flexDirection: 'row', gap: 60 }}>
          <HudPanel p={me} tint={CYAN} align="left" />
          <HudPanel p={them} tint={PURPLE} align="right" />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 12 }}>
          <Fighter p={me} tint={CYAN} side="left" />
          <Fighter p={them} tint={PURPLE} side="right" />
        </View>
      </View>

      {/* holographic centre-court projection under the VS */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ width: 210, height: 52, borderRadius: 999, borderWidth: 1, borderColor: `${PURPLE}30` }} />
        <View style={{ position: 'absolute', top: 8, width: 150, height: 36, borderRadius: 999, borderWidth: 1, borderColor: `${CYAN}26` }} />
      </View>

      {/* the focal point: on the fighters' eye line */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 168, alignItems: 'center' }}>
        <CinematicVS />
      </View>
    </View>
  );
}

/** One elegant rules panel: glowing glyphs, hairline separators. */
export function BattleRulesPanel({ rules }: { rules: readonly { glyph: string; text: string }[] }) {
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(120,170,220,0.14)',
        backgroundColor: 'rgba(6,12,24,0.6)',
        paddingVertical: 14,
      }}
    >
      <Text className="text-center text-2xs font-bold" style={{ color: CYAN, letterSpacing: 3 }}>
        BATTLE RULES
      </Text>
      <View className="mt-s3 flex-row">
        {rules.map((rule, i) => (
          <View
            key={rule.text}
            className="flex-1 items-center gap-s1 px-s2"
            style={i > 0 ? { borderLeftWidth: 1, borderLeftColor: 'rgba(120,170,220,0.12)' } : undefined}
          >
            <Text style={{ fontSize: 20, textShadowColor: `${CYAN}99`, textShadowRadius: 12 }}>{rule.glyph}</Text>
            <Text className="text-center text-2xs text-text-dim">{rule.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The event CTA: huge, glossy, pulsing until pressed. */
export function ReadyCTA({
  title,
  onPress,
  disabled = false,
  busy = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion || disabled) {
      glow.value = withTiming(0, { duration: 300 });
      return;
    }
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, disabled]);
  const halo = useAnimatedStyle(() => ({
    shadowOpacity: 0.3 + glow.value * 0.45,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[{ shadowColor: CYAN, shadowRadius: 22, shadowOffset: { width: 0, height: 4 }, elevation: 10 }, halo]}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        accessibilityRole="button"
        onPressIn={() => (scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 16, stiffness: 300 }))}
        testID={testID}
      >
        <LinearGradient
          colors={
            disabled
              ? [tokens.colors['surface-2'], tokens.colors['surface-2']]
              : [tokens.colors['accent-strong'], tokens.colors.accent, tokens.colors['accent-deep']]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 16, paddingVertical: 19, alignItems: 'center', overflow: 'hidden' }}
        >
          {/* gloss reflection — a whisper of light, not a white pill */}
          {!disabled ? (
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%' }}
            />
          ) : null}
          {busy ? (
            <ActivityIndicator color={tokens.colors['accent-ink']} />
          ) : (
            <Text
              style={{
                fontWeight: '900',
                fontSize: 16,
                letterSpacing: 2,
                color: disabled ? tokens.colors['text-mute'] : tokens.colors['accent-ink'],
              }}
            >
              {title}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}
