/**
 * The 12 keyframe animations of `assets/styles.css §14`, as data.
 *
 * CSS keyframes don't exist on native, so what ports is the *timing contract*:
 * every stop, duration, easing and iteration count, transcribed verbatim from
 * the stylesheet (durations from the animation: usage sites, since CSS sets
 * them where the keyframe is applied, not where it is defined). Components
 * drive these through Reanimated/Moti in later phases; this file is the single
 * place a designer's number lives.
 *
 * Rules carried over from the Streamlit app's hard lessons:
 *  - One-shot animations END at opacity 0 (toastIn, xpToastPop, unlockFlash,
 *    statSurge). Never "fast-forward" them to skip motion — a fast-forwarded
 *    toast is an invisible toast. Disable ambient LOOPS by name instead
 *    (perf mode / reduced-motion turns off `loop: true` entries only).
 *  - fillGrow animates from width 0 to the target; the target is the value the
 *    XP math produced, never a hardcoded stop.
 */

import tokens from './tokens';

/** One keyframe stop: offset 0..1, plus the animated properties at that stop. */
export interface KeyframeStop {
  offset: number;
  opacity?: number;
  scale?: number | { x: number; y: number };
  translateY?: number;
  /** background-position x, in percent — sheen only. */
  backgroundPositionX?: number;
  /** width, in percent of the fill target — fillGrow only. */
  widthPct?: number;
}

export interface AnimationSpec {
  /** Duration in ms. */
  duration: number;
  /** cubic-bezier control points, or 'linear' / 'steps' as the CSS says. */
  easing: readonly [number, number, number, number] | 'linear' | 'steps';
  /** true = repeats forever (ambient; may be disabled by perf mode). */
  loop: boolean;
  stops: KeyframeStop[];
}

const { duration } = tokens;

/** tokens.js is plain JS, so its arrays infer as number[]; narrow with a check. */
function bezier(points: number[]): readonly [number, number, number, number] {
  if (points.length !== 4) {
    throw new Error(`easing needs 4 control points, got ${points.length}`);
  }
  return points as unknown as readonly [number, number, number, number];
}

const easing = {
  base: bezier(tokens.easing.base),
  out: bezier(tokens.easing.out),
};

export const animations = {
  /** Progress/XP bars growing to their value. 700ms on XP bars, --dur-slow elsewhere. */
  fillGrow: {
    duration: duration.slow,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, widthPct: 0 },
      { offset: 1, widthPct: 100 },
    ],
  },
  /** XP-bar variant of fillGrow: .ef-xp-fill / .ef-side-xp-fill use 700ms. */
  fillGrowXp: {
    duration: 700,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, widthPct: 0 },
      { offset: 1, widthPct: 100 },
    ],
  },
  /** Highlight sweep across a fill. */
  sheen: {
    duration: 2400,
    easing: 'linear',
    loop: true,
    stops: [
      { offset: 0, backgroundPositionX: -120 },
      { offset: 1, backgroundPositionX: 220 },
    ],
  },
  /** Avatar idle hover. Runs together with breathe, same clock. */
  idleFloat: {
    duration: 4600,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, translateY: 0 },
      { offset: 0.5, translateY: -8 },
      { offset: 1, translateY: 0 },
    ],
  },
  /** Avatar breathing: asymmetric scale, x and y differ. */
  breathe: {
    duration: 4600,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, scale: { x: 1, y: 1 } },
      { offset: 0.5, scale: { x: 1.012, y: 0.992 } },
      { offset: 1, scale: { x: 1, y: 1 } },
    ],
  },
  /** Rarity aura behind the avatar. 3.4s on cards, 4.2s on the big stage. */
  auraPulse: {
    duration: 3400,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, opacity: 0.42, scale: 0.97 },
      { offset: 0.5, opacity: 0.72, scale: 1.06 },
      { offset: 1, opacity: 0.42, scale: 0.97 },
    ],
  },
  auraPulseStage: {
    duration: 4200,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, opacity: 0.42, scale: 0.97 },
      { offset: 0.5, opacity: 0.72, scale: 1.06 },
      { offset: 1, opacity: 0.42, scale: 0.97 },
    ],
  },
  /** Ground shadow counter-pulsing under idleFloat. */
  groundPulse: {
    duration: 4600,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, opacity: 0.5, scale: 1 },
      { offset: 0.5, opacity: 0.28, scale: 0.86 },
      { offset: 1, opacity: 0.5, scale: 1 },
    ],
  },
  /** Rare lens-flare glint on epic+ avatars. steps(1, end): hard cuts, no tween. */
  flareFlicker: {
    duration: 5500,
    easing: 'steps',
    loop: true,
    stops: [
      { offset: 0, opacity: 0 },
      { offset: 0.88, opacity: 0 },
      { offset: 0.9, opacity: 0.5 },
      { offset: 0.92, opacity: 0.12 },
      { offset: 0.94, opacity: 0.62 },
      { offset: 0.96, opacity: 0.2 },
      { offset: 1, opacity: 0 },
    ],
  },
  /** One-shot flash on evolution unlock. Ends at 0. */
  unlockFlash: {
    duration: 1500,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, opacity: 0, scale: 0.8 },
      { offset: 0.18, opacity: 0.55, scale: 1 },
      { offset: 1, opacity: 0, scale: 1.25 },
    ],
  },
  /** Stat delta floating up and out. Ends at 0. */
  statSurge: {
    duration: 1400,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, opacity: 0, translateY: 8 },
      { offset: 0.25, opacity: 1, translateY: 0 },
      { offset: 0.75, opacity: 1, translateY: 0 },
      { offset: 1, opacity: 0, translateY: -8 },
    ],
  },
  /** Standard toast: in, hold, out. Whole life in one 4s curve. Ends at 0. */
  toastIn: {
    duration: 4000,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, opacity: 0, translateY: 16, scale: 0.97 },
      { offset: 0.08, opacity: 1, translateY: 0, scale: 1 },
      { offset: 0.88, opacity: 1, translateY: 0, scale: 1 },
      { offset: 1, opacity: 0, translateY: 10, scale: 0.98 },
    ],
  },
  /** +XP toast pop: overshoot in, hold, fade. Ends at 0. */
  xpToastPop: {
    duration: 2600,
    easing: easing.out,
    loop: false,
    stops: [
      { offset: 0, opacity: 0, scale: 0.82 },
      { offset: 0.14, opacity: 1, scale: 1.04 },
      { offset: 0.24, opacity: 1, scale: 1 },
      { offset: 0.82, opacity: 1, scale: 1 },
      { offset: 1, opacity: 0, scale: 0.96 },
    ],
  },
  /** The XP number pulsing inside the toast, while the toast lives. */
  xpPulse: {
    duration: 1100,
    easing: easing.base,
    loop: true,
    stops: [
      { offset: 0, opacity: 0.9, scale: 1 },
      { offset: 0.5, opacity: 1, scale: 1.16 },
      { offset: 1, opacity: 0.9, scale: 1 },
    ],
  },
} as const satisfies Record<string, AnimationSpec>;

export type AnimationName = keyof typeof animations;

/**
 * Motion duration tokens for NEW interactions (the 12 legacy keyframes above
 * keep their transcribed timings). No magic milliseconds in components.
 */
export const durations = {
  /** press feedback, chip toggles, small state flips */
  micro: 150,
  /** panel/sheet transitions, row collapse */
  panel: 260,
  /** floating XP, completion pulses, per-set rewards */
  reward: 550,
  /** level-up, evolution ceremonies */
  major: 1200,
} as const;
