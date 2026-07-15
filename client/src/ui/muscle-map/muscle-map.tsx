import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { backMaskFor } from './back-masks';
import { backMusclePaths } from './back-muscle-paths';
import { frontMaskFor } from './front-masks';
import { frontMusclePaths } from './front-muscle-paths';
import { MaskOverlay, MuscleOverlay } from './muscle-overlay';
import { MAP_VIEW_H, MAP_VIEW_W, MUSCLE_LABEL, type MapFocus, type MuscleId, type MuscleView } from './types';

/**
 * MUSCLE MAP — the black 16-bit base character with neon-cyan overlays over
 * the muscles a workout targets (Tyson's spec, 2026-07-15).
 *
 * THE BASE IMAGES ARE PERMANENT TEMPLATES (assets/muscle-map/) — never
 * recoloured, regenerated or redesigned. Highlight = SVG paths in the
 * images' own 887×1774 pixel grid, absolutely positioned over an Image that
 * shares one aspect-ratio container: alignment survives every screen size
 * because both read the same box, never independent pixel measurements.
 */

// Static requires — Metro resolves them at build time.
const FRONT_BASE = require('../../../assets/muscle-map/muscle-front-base.png');
const BACK_BASE = require('../../../assets/muscle-map/muscle-back-base.png');

/** The view that lights MORE of these muscles — a Pull day should not open
 *  onto a front view showing two lit biceps and a dark everything-else. */
export function bestViewFor(muscles: readonly MuscleId[]): MuscleView {
  const front = muscles.filter((m) => frontMusclePaths[m]).length;
  const back = muscles.filter((m) => backMusclePaths[m]).length;
  return back > front ? 'back' : 'front';
}

/**
 * The zoom windows, in image coords. An all-upper-body day fills the frame
 * with the torso; an all-lower day with the legs; a mixed day shows the whole
 * figure. Both halves share one height so the card never jumps between them.
 */
const CROP: Readonly<Record<MapFocus, { y: number; h: number }>> = {
  full: { y: 0, h: MAP_VIEW_H },
  upper: { y: 60, h: 920 }, // head → hands/waist
  lower: { y: 720, h: 920 }, // glutes → feet
};

export function MuscleMap({
  selectedMuscles,
  view = 'front',
  interactive = false,
  onMusclePress,
  width,
  pulse = false,
  focus = 'full',
  maskOpacity = 0.8,
  useMasks = true,
  testID = 'muscle-map',
}: {
  selectedMuscles: readonly MuscleId[];
  view?: MuscleView;
  interactive?: boolean;
  onMusclePress?: (muscle: MuscleId) => void;
  /** Fixed width; omit to fill the parent. Height follows the aspect ratio. */
  width?: number;
  pulse?: boolean;
  /** Zoom window — derive from the selection with domain focusFor(). */
  focus?: MapFocus;
  /** Krita mask layer opacity (the muscle-lab tunes this). */
  maskOpacity?: number;
  /** false = legacy SVG overlays even where a Krita mask exists (the
   *  muscle-lab's comparison switch). */
  useMasks?: boolean;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  // Quick fade on view switch (no 3D theatrics): fade out, swap, fade in.
  // Reduced motion renders the new view directly — no state write, no fade.
  const [delayedView, setDelayedView] = useState<MuscleView>(view);
  const shownView = reducedMotion ? view : delayedView;
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion || view === delayedView) return;
    fade.value = withTiming(0, { duration: 110 });
    const t = setTimeout(() => {
      setDelayedView(view);
      fade.value = withTiming(1, { duration: 110 });
    }, 120);
    return () => clearTimeout(t);
  }, [view, delayedView, reducedMotion, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const table = shownView === 'front' ? frontMusclePaths : backMusclePaths;
  // Dedupe, then keep only what this view can draw (a path or a Krita mask).
  const maskSourceFor = (m: MuscleId) =>
    useMasks ? (shownView === 'front' ? frontMaskFor(m) : backMaskFor(m)) : null;
  const lit = [...new Set(selectedMuscles)].filter((m) => table[m] || maskSourceFor(m));
  // Tyson's hand-drawn Krita masks are the source of truth where they exist;
  // regions without artwork yet keep the generated SVG paths.
  const masked = lit.filter((m) => maskSourceFor(m));
  const pathDrawn = lit.filter((m) => !maskSourceFor(m) && table[m]);

  const label =
    lit.length === 0
      ? 'Muscle map. No muscles selected.'
      : `Muscle map. ${lit.map((m) => MUSCLE_LABEL[m]).join(', ')} selected.`;

  // The zoom is a crop window over ONE shared Image+Svg stack: the outer box
  // clips, the inner box is the full figure scaled to the box's width and
  // shifted so the window shows. Both layers ride the same box, so the
  // overlay cannot drift from the art at any size or focus.
  const crop = CROP[focus];
  const [boxW, setBoxW] = useState(0);
  const scale = boxW / MAP_VIEW_W;

  return (
    <Animated.View
      onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
      style={[
        { width: width ?? '100%', aspectRatio: MAP_VIEW_W / crop.h, alignSelf: 'center', overflow: 'hidden' },
        fadeStyle,
      ]}
      accessibilityLabel={label}
      testID={testID}
    >
      {boxW > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: -crop.y * scale,
            width: boxW,
            height: MAP_VIEW_H * scale,
          }}
        >
          <Image
            source={shownView === 'front' ? FRONT_BASE : BACK_BASE}
            resizeMode="contain"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            accessibilityIgnoresInvertColors
          />
          {/* Krita mask layers: same box, same resizeMode, no per-muscle
              offsets — alignment is the artwork's, never the code's. */}
          {masked.map((m) => (
            <MaskOverlay
              key={`mask:${shownView}:${m}`}
              muscle={m}
              source={maskSourceFor(m)!}
              pulse={pulse}
              maskOpacity={maskOpacity}
            />
          ))}
          <Svg
            style={{ position: 'absolute', top: 0, left: 0 }}
            width="100%"
            height="100%"
            viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
            pointerEvents={interactive ? 'auto' : 'none'}
            testID={`${testID}-svg-${shownView}`}
          >
            {pathDrawn.map((m) => (
              <MuscleOverlay
                key={`${shownView}:${m}`}
                muscle={m}
                sides={table[m]!}
                pulse={pulse}
                interactive={interactive}
                onPress={onMusclePress}
              />
            ))}
            {/* Masked muscles still need per-muscle press geometry. */}
            {interactive
              ? masked
                  .filter((m) => table[m])
                  .map((m) => (
                    <MuscleOverlay
                      key={`hit:${shownView}:${m}`}
                      muscle={m}
                      sides={table[m]!}
                      interactive
                      onPress={onMusclePress}
                      hitOnly
                    />
                  ))
              : null}
          </Svg>
        </View>
      ) : null}
    </Animated.View>
  );
}
