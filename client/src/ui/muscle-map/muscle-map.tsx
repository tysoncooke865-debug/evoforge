import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { backMusclePaths } from './back-muscle-paths';
import { frontMusclePaths } from './front-muscle-paths';
import { MuscleOverlay } from './muscle-overlay';
import { MAP_VIEW_H, MAP_VIEW_W, MUSCLE_LABEL, type MuscleId, type MuscleView } from './types';

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

export function MuscleMap({
  selectedMuscles,
  view = 'front',
  interactive = false,
  onMusclePress,
  width,
  pulse = false,
  testID = 'muscle-map',
}: {
  selectedMuscles: readonly MuscleId[];
  view?: MuscleView;
  interactive?: boolean;
  onMusclePress?: (muscle: MuscleId) => void;
  /** Fixed width; omit to fill the parent. Height follows the aspect ratio. */
  width?: number;
  pulse?: boolean;
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
  // Dedupe, then keep only what this view can draw.
  const lit = [...new Set(selectedMuscles)].filter((m) => table[m]);

  const label =
    lit.length === 0
      ? 'Muscle map. No muscles selected.'
      : `Muscle map. ${lit.map((m) => MUSCLE_LABEL[m]).join(', ')} selected.`;

  return (
    <Animated.View
      style={[{ width: width ?? '100%', aspectRatio: MAP_VIEW_W / MAP_VIEW_H, alignSelf: 'center' }, fadeStyle]}
      accessibilityLabel={label}
      testID={testID}
    >
      <Image
        source={shownView === 'front' ? FRONT_BASE : BACK_BASE}
        resizeMode="contain"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
        accessibilityIgnoresInvertColors
      />
      <Svg
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        width="100%"
        height="100%"
        viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
        pointerEvents={interactive ? 'auto' : 'none'}
        testID={`${testID}-svg-${shownView}`}
      >
        {lit.map((m) => (
          <MuscleOverlay
            key={`${shownView}:${m}`}
            muscle={m}
            sides={table[m]!}
            pulse={pulse}
            interactive={interactive}
            onPress={onMusclePress}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}
