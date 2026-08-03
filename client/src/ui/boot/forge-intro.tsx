/**
 * THE FORGE INTRO — EvoForge's launch sequence.
 *
 * "Molten fragments fly together, sparks shower downward, edges glow white
 * hot, metal cools into electric blue." The whole thing is procedural: no
 * video, no GIF, no Lottie, no image asset. Two dependencies the app already
 * ships (Reanimated for motion, react-native-svg for the sigil) draw all of it,
 * which is why it costs the bundle nothing and scales to any screen.
 *
 * ---- ONE CLOCK ----
 *
 * Every layer — the embers, the spiral, the sigil, the flash, the shake, the
 * fragments, each letter, the sparks, the pulse, the tagline, the dissolve —
 * is a WINDOW on one 0→1 shared value (domain/boot-sequence.ts). On web every
 * Reanimated loop runs on the main JS thread, so the cost of motion is the
 * number of DRIVERS, not the number of effects; six independent timers would
 * also have been six chances for the beats to drift apart from each other.
 *
 * ---- LAYERS MOUNT AND UNMOUNT ----
 *
 * A worklet that has finished still runs every frame. The `stage` state below
 * is advanced by timers at the stage boundaries (never per frame) so each
 * layer only EXISTS while it has something to do: the ~40 animated nodes in
 * the whole sequence are never more than ~22 at once. That is what holds the
 * frame budget on a phone.
 *
 * ---- WHAT IS DELIBERATELY NOT HERE ----
 *
 * REACT NATIVE SKIA. The brief names it, and it is not in this project — it is
 * a native module, so adding it means a prebuild and a native rebuild for an
 * app whose primary surface is an installed PWA on Cloudflare Pages. The
 * effects it would have bought (true bloom, real motion blur) are approximated
 * here with layered shadows, overlapping translucent squares and trail copies.
 * If EvoForge ever ships a native binary, this file is where Skia would earn
 * its place; today it would be a large dependency for one screen.
 *
 * PIXELLAB. `PIXELLAB_AI_KEY` exists in this repo, but it is a BUILD-TIME
 * secret (scripts/arena-pixellab-gen.mjs) and not an `EXPO_PUBLIC_` value —
 * putting it in the client bundle would publish it to every visitor. Generated
 * forge backdrops would also be exactly the heavy image assets the brief asks
 * to avoid. The rotating environments the brief wants are here instead as
 * procedural palettes (domain/boot-sequence.ts::FORGE_ENVIRONMENTS), one per
 * calendar day.
 */

import * as Haptics from 'expo-haptics';
import { memo, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  BOOT_REDUCED_MS,
  BOOT_TOTAL_MS,
  STAGE,
  forgeEnvironmentFor,
  seg,
  stageStartMs,
  type BootStage,
} from '@/domain/boot-sequence';
import { todayIso } from '@/domain/today';
import { PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { ForgeHammer, ForgeSigil } from './forge-sigil';

/**
 * EVERY ANIMATED LAYER CARRIES ITS RESTING VALUE IN THE STATIC STYLE.
 *
 * A Reanimated style is applied on the worklet's FIRST EVALUATION, not on the
 * first paint. Until then only the base style object exists — so a layer whose
 * opacity lives solely in the worklet paints at OPACITY 1 for the frames before
 * the animation engine runs. The strike flash is a full-screen wash of
 * accent-strong; it washed the entire launch screen pale cyan on the static
 * pre-render and on every slow first frame.
 *
 * This is the same failure family as the July PWA bug (visibility depending on
 * an animation firing), one level down. `HIDDEN` is the base every timed layer
 * starts from: correct with no animation engine at all, and overridden the
 * instant there is one.
 */
const HIDDEN = { opacity: 0 } as const;

const WORDMARK = 'EVOFORGE';
const TAGLINE = 'FORGE YOUR ASCENSION';

/** Embers drifting inward. Fixed table, so the field is identical every launch
 *  (a "random" starfield that differs per launch reads as noise, not design). */
const EMBERS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 + 0.6;
  return {
    angle,
    /** Where it starts, as a fraction of the half-diagonal. */
    from: 0.62 + ((i * 7) % 5) * 0.08,
    size: 2 + (i % 3),
    phase: (i * 13) % 100 / 100,
    spin: i % 2 === 0 ? 1 : -1,
  };
});

/** Molten fragments that converge on the wordmark. */
const FRAGMENTS = Array.from({ length: 14 }, (_, i) => ({
  /** Start offset from the wordmark's centre, in points. */
  dx: (((i * 37) % 19) - 9) * 22,
  dy: (((i * 53) % 11) - 5) * 17,
  size: 3 + (i % 4),
  delay: ((i * 29) % 10) / 10, // 0–0.9 of the forge window
}));

/** Sparks showering down off the wordmark as it cools. */
const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  x: (((i * 41) % 17) - 8) * 13,
  size: 2 + (i % 2),
  delay: ((i * 19) % 10) / 10,
  drift: (((i * 23) % 7) - 3) * 6,
}));

export const ForgeIntro = memo(function ForgeIntro({
  reduced,
  onSkip,
}: {
  /** The athlete asked for less motion — a different sequence, not a faster one. */
  reduced: boolean;
  /** Tapping anywhere ends the intro early. */
  onSkip: () => void;
}) {
  const colors = useThemeColors();
  /**
   * THE BOX IS MEASURED, NOT ASKED FOR.
   *
   * `useWindowDimensions()` returns 0×0 here on the web build — Expo STATICALLY
   * PRE-RENDERS every route in Node, where react-native-web's Dimensions module
   * has no window, and hydration does not re-run the render with corrected
   * values. The wordmark shipped at `font-size: 0` because of it: eight
   * one-pixel letters, invisible, on an otherwise perfect animation.
   *
   * onLayout reports the real box on every platform and after hydration, and
   * the fallbacks below mean the sequence is correctly sized even on the frame
   * before it arrives — a launch screen must never be waiting for a
   * measurement to look right.
   */
  const [box, setBox] = useState({ w: 0, h: 0 });
  /** The wordmark's own rect inside the stage — the pulse must cross THE LOGO,
   *  and the only way to be sure of that is to measure where the logo is. It
   *  was centred on the stage instead and ran through the tagline. */
  const [word, setWord] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const width = box.w || 360;
  const height = box.h || 760;
  const env = forgeEnvironmentFor(todayIso());
  const palette = colors as unknown as Record<string, string>;
  const ember = palette[env.ember] ?? colors.accent;
  const halo = palette[env.halo] ?? colors['accent-deep'];

  const total = reduced ? BOOT_REDUCED_MS : BOOT_TOTAL_MS;
  const t = useSharedValue(0);
  // Which layers exist right now. Advanced by TIMERS, never per frame.
  const [stage, setStage] = useState<BootStage>('ember');

  useEffect(() => {
    t.value = withTiming(1, { duration: total, easing: Easing.linear });
    if (reduced) {
      // The calm path: no spiral, no strike, no particle fields. Jump straight
      // to the state where the wordmark and the tagline simply exist.
      const to = setTimeout(() => setStage('etch'), Math.round(total * 0.25));
      return () => clearTimeout(to);
    }
    const timers = (['spiral', 'strike', 'forge', 'etch', 'open'] as const).map((s) =>
      setTimeout(() => setStage(s), stageStartMs(s, total))
    );
    // THE STRIKE'S HAPTIC. Fired from a timer rather than from an animation
    // callback so it lands even on a device where a frame is dropped — and it
    // is the only haptic in the sequence, because a launch screen that buzzes
    // repeatedly is a launch screen people turn off.
    const hit = setTimeout(() => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, stageStartMs('strike', total));
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(hit);
    };
  }, [total, reduced, t]);

  const reach = Math.hypot(width, height) / 2;
  const sigilSize = Math.max(180, Math.min(width * 0.86, height * 0.5, 380));
  // Floors on every derived size: a zero here is an invisible logo, and an
  // invisible logo is the whole screen failing silently.
  const letterSize = Math.max(22, Math.min(width * 0.098, 42));

  /* ---- THE CAMERA. One transform on the root, carrying the push-in, the
     strike shake and the final rise. Reduced motion gets none of it. ---- */
  const camera = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ scale: 1 }] };
    const push = 1 + seg(t.value, 0, STAGE.forge[1]) * 0.06;
    // A decaying oscillation over ~260ms after the hammer lands.
    const s = seg(t.value, STAGE.strike[0], STAGE.strike[0] + 0.096);
    const decay = s > 0 && s < 1 ? Math.pow(1 - s, 2) : 0;
    const rise = seg(t.value, STAGE.open[0], 1);
    return {
      transform: [
        { translateX: Math.sin(s * Math.PI * 9) * 13 * decay },
        { translateY: Math.cos(s * Math.PI * 7) * 9 * decay - rise * 34 },
        { scale: push * (1 + rise * 0.1) },
      ],
    };
  });

  /* ---- The whole plate fades out as the forge opens. ---- */
  const veil = useAnimatedStyle(() => ({ opacity: 1 - seg(t.value, STAGE.open[0] + 0.03, 1) }));

  /* ---- THE SIGIL: resolves in, then counter-rotates. ---- */
  const sigilStyle = useAnimatedStyle(() => {
    const p = reduced ? 1 : seg(t.value, STAGE.ember[1], STAGE.spiral[1]);
    const spin = t.value * (reduced ? 0 : 26);
    const bloom = reduced ? 0 : seg(t.value, STAGE.strike[0], STAGE.strike[1]);
    // It recedes HARD once the wordmark starts assembling — the sigil is the
    // room, and the room must not compete with the thing being made in it.
    return {
      opacity: p * (0.92 - seg(t.value, STAGE.strike[1], STAGE.etch[0]) * 0.8),
      transform: [{ rotate: `${spin}deg` }, { scale: 0.86 + p * 0.14 + bloom * 0.1 }],
    };
  });

  /* ---- THE STRIKE FLASH ----
     Two parts, because one full-screen wash at full strength is not a flash,
     it is a repaint: for ~200ms the entire screen went pale cyan and the
     sequence read as broken. The WASH now peaks at 0.55 and is gone in ~160ms;
     the BLOOM — a white disc that expands out of the anvil — carries the
     actual impact, which is where the eye already is. */
  const flash = useAnimatedStyle(() => {
    const p = seg(t.value, STAGE.strike[0], STAGE.strike[0] + 0.06);
    return { opacity: p > 0 && p < 1 ? Math.pow(1 - p, 2.2) * 0.55 : 0 };
  });
  const bloom = useAnimatedStyle(() => {
    const p = seg(t.value, STAGE.strike[0], STAGE.strike[0] + 0.085);
    if (p <= 0 || p >= 1) return { opacity: 0 };
    return { opacity: Math.pow(1 - p, 1.8), transform: [{ scale: 0.15 + p * 2.6 }] };
  });

  /* ---- The hammer: falls from above, lands on the anvil, gone. ---- */
  // It falls from off-screen, accelerating, and STOPS with its face on the
  // anvil — then the flash takes over and it is gone. `rest` is where the head
  // sits at the moment of contact, measured off the sigil so the two agree at
  // every screen size.
  const hammerRest = sigilSize * 0.02;
  const hammer = useAnimatedStyle(() => {
    const fall = seg(t.value, STAGE.spiral[1] - 0.1, STAGE.strike[0]);
    const gone = seg(t.value, STAGE.strike[0], STAGE.strike[1] + 0.02);
    if (fall <= 0) return { opacity: 0 };
    return {
      opacity: (1 - gone) * 0.98,
      transform: [
        { translateY: hammerRest - (height * 0.9 + sigilSize) * (1 - Math.pow(fall, 3)) },
        // Swings through the last of the arc rather than arriving flat.
        { rotate: `${-26 * (1 - Math.pow(fall, 2))}deg` },
        { scale: 1 + gone * 0.22 },
      ],
    };
  });

  return (
    <Pressable
      onPress={onSkip}
      accessibilityRole="button"
      accessibilityLabel="skip intro"
      testID="forge-intro"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0 && (w !== box.w || h !== box.h)) setBox({ w, h });
      }}
      // NO ANIMATION GATES VISIBILITY. This plate is painted opaque from the
      // first frame and only its CONTENTS animate — the 2026-07-16 rule, which
      // exists because a Reanimated opacity gate once stranded an installed iOS
      // PWA on a blank screen when its animation frame failed to tick.
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9000,
        backgroundColor: colors['bg-deep'],
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
          veil,
        ]}
      >
        <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, camera]}>
          {/* THE SIGIL + the room it stands in. */}
          <Animated.View style={[{ position: 'absolute', ...HIDDEN }, sigilStyle]}>
            <ForgeSigil size={sigilSize} colour={ember} halo={halo} />
          </Animated.View>

          {/* EMBERS — only while there is nothing else to look at. */}
          {!reduced && (stage === 'ember' || stage === 'spiral' || stage === 'strike')
            ? EMBERS.map((e, i) => (
                <Ember key={i} {...e} t={t} reach={reach} colour={ember} />
              ))
            : null}

          {/* THE HAMMER. A stepped pixel wedge, not a picture of a hammer. */}
          {!reduced && (stage === 'spiral' || stage === 'strike') ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  shadowColor: colors.accent,
                  shadowOpacity: 0.9,
                  shadowRadius: 26,
                  ...HIDDEN,
                },
                hammer,
              ]}
            >
              <ForgeHammer size={sigilSize * 0.32} metal={colors.text} edge={colors['accent-strong']} />
            </Animated.View>
          ) : null}

          {/* THE IMPACT BLOOM — white hot, out of the anvil, gone in 230ms. */}
          {!reduced && stage === 'strike' ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: sigilSize * 0.23,
                  width: sigilSize * 0.34,
                  height: sigilSize * 0.34,
                  borderRadius: sigilSize * 0.17,
                  backgroundColor: colors.text,
                  shadowColor: colors['accent-strong'],
                  shadowOpacity: 1,
                  shadowRadius: 60,
                  ...HIDDEN,
                },
                bloom,
              ]}
            />
          ) : null}

          {/* MOLTEN FRAGMENTS converging on the wordmark. */}
          {!reduced && (stage === 'strike' || stage === 'forge')
            ? FRAGMENTS.map((f, i) => (
                <Fragment key={i} {...f} t={t} hot={colors.text} cool={colors.accent} />
              ))
            : null}

          {/* THE WORDMARK — assembled letter by letter, lifted clear of the
              anvil the hammer just hit. */}
          <View
            className="flex-row"
            style={{ zIndex: 2, marginTop: -sigilSize * 0.26 }}
            onLayout={(e) => {
              const { x, y, width: w, height: h } = e.nativeEvent.layout;
              if (w > 0 && (w !== word.w || y !== word.y)) setWord({ x, y, w, h });
            }}
          >
            {WORDMARK.split('').map((ch, i) => (
              <Letter
                key={i}
                char={ch}
                index={i}
                count={WORDMARK.length}
                t={t}
                reduced={reduced}
                size={letterSize}
                hot={colors.text}
                cool={colors.accent}
              />
            ))}
          </View>

          {/* SPARKS off the cooling metal. */}
          {!reduced && (stage === 'forge' || stage === 'etch')
            ? SPARKS.map((s, i) => (
                <Spark key={i} {...s} t={t} colour={colors.legendary} />
              ))
            : null}

          {/* THE ENERGY PULSE that crosses the wordmark and lights the etch. */}
          {!reduced && (stage === 'etch' || stage === 'open') && word.w > 0 ? (
            <Pulse t={t} rect={word} colour={colors['accent-strong']} />
          ) : null}

          {/* THE TAGLINE, burned in character by character behind the pulse. */}
          <Tagline t={t} reduced={reduced} accent={colors.accent} cool={colors.text} />

        </Animated.View>
      </Animated.View>

      {/* Which forge this is. OUT of the flow column and pinned near the foot:
          in the middle it collided with the hammer's head at the exact moment
          the hammer was the only thing on screen. */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 46, alignItems: 'center' }}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 3, color: colors['text-mute'], opacity: 0.7 }}
        >
          {env.label}
        </Text>
      </View>

      {/* THE FLASH sits above everything, including the camera transform — a
          strike that shakes with the scene reads as part of the scene. */}
      {!reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors['accent-strong'], ...HIDDEN },
            flash,
          ]}
        />
      ) : null}

    </Pressable>
  );
});

/** One drifting ember: spirals inward, brightening as it goes. */
function Ember({
  angle,
  from,
  size,
  phase,
  spin,
  t,
  reach,
  colour,
}: {
  angle: number;
  from: number;
  size: number;
  phase: number;
  spin: number;
  t: { value: number };
  reach: number;
  colour: string;
}) {
  const style = useAnimatedStyle(() => {
    // Inward across ember+spiral, then it is consumed by the strike.
    const p = seg(t.value, 0, STAGE.spiral[1]);
    const eased = 1 - Math.pow(1 - p, 2);
    const r = reach * from * (1 - eased * 0.86);
    // The spiral: the angle winds once the second stage begins.
    const wind = seg(t.value, STAGE.ember[1], STAGE.spiral[1]) * spin * 1.5;
    const a = angle + wind + phase * 0.4;
    const consumed = seg(t.value, STAGE.spiral[1] - 0.02, STAGE.strike[1]);
    return {
      opacity: Math.min(1, p * 2.4) * (1 - consumed) * 0.9,
      transform: [
        { translateX: Math.cos(a) * r },
        { translateY: Math.sin(a) * r },
        { scale: 0.6 + eased * 0.8 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          // SQUARE: this is a pixel game, even in its opening frames.
          width: size,
          height: size,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.9,
          shadowRadius: 8,
          ...HIDDEN,
        },
        style,
      ]}
    />
  );
}

/**
 * One molten fragment. It flies in from an offset, arrives white hot, and its
 * trail is faked the cheap way — the square is stretched along its direction of
 * travel while it is fast, which is what motion blur looks like at this size
 * and costs nothing a shader would.
 */
function Fragment({
  dx,
  dy,
  size,
  delay,
  t,
  hot,
  cool,
}: {
  dx: number;
  dy: number;
  size: number;
  delay: number;
  t: { value: number };
  hot: string;
  cool: string;
}) {
  const style = useAnimatedStyle(() => {
    const from = STAGE.strike[0] + delay * 0.06;
    const to = STAGE.forge[0] + 0.12 + delay * 0.05;
    const p = seg(t.value, from, to);
    if (p <= 0) return { opacity: 0 };
    const eased = 1 - Math.pow(1 - p, 3);
    const speed = 1 - eased;
    return {
      opacity: p < 1 ? 1 : 0,
      transform: [
        { translateX: dx * (1 - eased) },
        { translateY: dy * (1 - eased) },
        { scaleX: 1 + speed * 2.6 },
        { scale: 0.7 + eased * 0.3 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          backgroundColor: hot,
          shadowColor: cool,
          shadowOpacity: 1,
          shadowRadius: 12,
          ...HIDDEN,
        },
        style,
      ]}
    />
  );
}

/**
 * One letter of the wordmark. It does not fade and it does not scale — it
 * ARRIVES: dropped into place with a short overshoot, white hot at the moment
 * it lands, cooling to electric blue over the next third of a second. Each
 * letter has its own window, so the word assembles left to right.
 */
function Letter({
  char,
  index,
  count,
  t,
  reduced,
  size,
  hot,
  cool,
}: {
  char: string;
  index: number;
  count: number;
  t: { value: number };
  reduced: boolean;
  size: number;
  hot: string;
  cool: string;
}) {
  const span = STAGE.forge[1] - STAGE.forge[0];
  const from = STAGE.forge[0] + (index / count) * span * 0.62;
  const to = from + span * 0.34;

  const style = useAnimatedStyle(() => {
    if (reduced) {
      const p = seg(t.value, 0.05, 0.45);
      return { opacity: p, transform: [{ scale: 1 }] };
    }
    const p = seg(t.value, from, to);
    // A single overshoot as it seats — metal landing, not a tween finishing.
    const overshoot = Math.sin(Math.min(1, p) * Math.PI) * 0.14;
    return {
      opacity: Math.min(1, p * 2.2),
      transform: [{ translateY: (1 - p) * -26 }, { scale: 0.8 + p * 0.2 + overshoot }],
    };
  });

  // THE COOLING is a colour SWAP on a timer, not an interpolation per frame:
  // interpolateColor on eight nodes every frame buys nothing an athlete can
  // see over two crossfading Texts, and costs it on the main thread.
  const [cooled, setCooled] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const total = BOOT_TOTAL_MS;
    const at = setTimeout(() => setCooled(true), to * total + 120);
    return () => clearTimeout(at);
  }, [reduced, to]);

  return (
    <Animated.Text
      allowFontScaling={false}
      style={[
        {
          fontFamily: PIXEL_BOLD,
          fontSize: size,
          lineHeight: Math.round(size * 1.15),
          letterSpacing: 1,
          color: cooled ? cool : hot,
          textShadowColor: cooled ? `${cool}cc` : '#ffffff',
          textShadowRadius: cooled ? 18 : 26,
          ...HIDDEN,
        },
        style,
      ]}
    >
      {char}
    </Animated.Text>
  );
}

/** A spark falling off the cooling wordmark. */
function Spark({
  x,
  size,
  delay,
  drift,
  t,
  colour,
}: {
  x: number;
  size: number;
  delay: number;
  drift: number;
  t: { value: number };
  colour: string;
}) {
  const style = useAnimatedStyle(() => {
    const from = STAGE.forge[0] + 0.05 + delay * 0.16;
    const p = seg(t.value, from, from + 0.2);
    if (p <= 0 || p >= 1) return { opacity: 0 };
    return {
      opacity: Math.pow(1 - p, 1.4),
      transform: [
        { translateX: x + drift * p },
        // Gravity: quadratic, so it accelerates the way a spark does.
        { translateY: 10 + p * p * 92 },
        { scale: 1 - p * 0.4 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 1,
          shadowRadius: 6,
          ...HIDDEN,
        },
        style,
      ]}
    />
  );
}

/**
 * The energy pulse crossing the wordmark left to right, positioned from the
 * wordmark's MEASURED rect so it can only ever be over the logo — the brief's
 * beat is "a single blue energy pulse travels across the logo", and a bar
 * centred on the stage instead ran down through the tagline.
 */
function Pulse({
  t,
  rect,
  colour,
}: {
  t: { value: number };
  rect: { x: number; y: number; w: number; h: number };
  colour: string;
}) {
  const style = useAnimatedStyle(() => {
    const p = seg(t.value, STAGE.etch[0], STAGE.etch[0] + 0.16);
    if (p <= 0 || p >= 1) return { opacity: 0 };
    return {
      opacity: Math.sin(p * Math.PI),
      transform: [{ translateX: p * (rect.w + 24) }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: rect.x - 12,
          top: rect.y - 8,
          width: 3,
          height: rect.h + 16,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 1,
          shadowRadius: 22,
          ...HIDDEN,
        },
        style,
      ]}
    />
  );
}

/**
 * THE TAGLINE, laser-etched. Each character is burned in behind the travelling
 * pulse — plasma-bright at the instant it appears, cooling to crisp white a
 * beat later. Per character rather than as one faded block because that is the
 * difference between text arriving and text being WRITTEN.
 */
function Tagline({
  t,
  reduced,
  accent,
  cool,
}: {
  t: { value: number };
  reduced: boolean;
  accent: string;
  cool: string;
}) {
  const chars = TAGLINE.split('');
  return (
    <View className="mt-s3 flex-row">
      {chars.map((ch, i) => (
        <TaglineChar
          key={i}
          char={ch}
          at={i / chars.length}
          t={t}
          reduced={reduced}
          accent={accent}
          cool={cool}
        />
      ))}
    </View>
  );
}

function TaglineChar({
  char,
  at,
  t,
  reduced,
  accent,
  cool,
}: {
  char: string;
  at: number;
  t: { value: number };
  reduced: boolean;
  accent: string;
  cool: string;
}) {
  const from = STAGE.etch[0] + at * 0.15;
  const style = useAnimatedStyle(() => {
    if (reduced) return { opacity: seg(t.value, 0.35, 0.7) };
    return { opacity: seg(t.value, from, from + 0.03) };
  });
  const [cooled, setCooled] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const to = setTimeout(() => setCooled(true), from * BOOT_TOTAL_MS + 240);
    return () => clearTimeout(to);
  }, [reduced, from]);
  return (
    <Animated.Text
      allowFontScaling={false}
      style={[
        {
          fontFamily: PIXEL_BOLD,
          fontSize: 11,
          letterSpacing: 2.4,
          color: cooled ? cool : accent,
          textShadowColor: cooled ? 'transparent' : accent,
          textShadowRadius: cooled ? 0 : 14,
          ...HIDDEN,
        },
        style,
      ]}
    >
      {char === ' ' ? ' ' : char}
    </Animated.Text>
  );
}
