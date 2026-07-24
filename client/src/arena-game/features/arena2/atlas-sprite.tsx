'use no memo'; // frame-driven from props each render (see ARENA_2.0_REDESIGN.md §13)

/**
 * Arena 2.0 — atlas-backed sprite renderer (Redesign P0).
 *
 * Draws ONE frame of a packed 128px spritesheet using the cross-platform
 * "clip-View" technique: an oversized <Image> of the whole sheet inside an
 * overflow-hidden window, translated so the requested cell fills the window.
 * Works on native + web, adds ZERO runtime dependencies, and keeps the arena's
 * no-Animated / no-per-unit-state doctrine (the frame index comes from the
 * caller's frame clock). Left-facing = a horizontal flip of the window.
 *
 * `anchorYOffset` (source px, from the AutoSprite import) shifts the sprite up
 * so every clip of a champion shares one feet/ground line.
 */
import React from 'react';
import {
  Image,
  type ImageSourcePropType,
  type ImageStyle,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

interface Props {
  sheet: ImageSourcePropType;
  /** Source cell size in px (128). */
  cell: number;
  cols: number;
  rows: number;
  frameIndex: number;
  /** Rendered px for one cell (the on-screen sprite size). */
  size: number;
  /** Face left (mirror horizontally). */
  mirror?: boolean;
  /** Feet-alignment offset in SOURCE px (from champion-anim metadata). */
  anchorYOffset?: number;
  style?: ViewStyle;
}

export function AtlasSprite({
  sheet,
  cell,
  cols,
  rows,
  frameIndex,
  size,
  mirror = false,
  anchorYOffset = 0,
  style,
}: Props) {
  const scale = size / cell;
  const idx = Math.max(0, Math.min(cols * rows - 1, frameIndex));
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const sheetW = cols * cell * scale;
  const sheetH = rows * cell * scale;
  const tx = -col * cell * scale;
  // Positive anchorYOffset = feet sit lower in the cell → shift content UP so
  // feet land on the shared ground line.
  const ty = -row * cell * scale - anchorYOffset * scale;
  return (
    <View
      style={[{ width: size, height: size, overflow: 'hidden' }, mirror && styles.mirror, style]}
      pointerEvents="none"
    >
      <Image
        source={sheet}
        style={[
          { width: sheetW, height: sheetH, transform: [{ translateX: tx }, { translateY: ty }] },
          PIXELATED,
        ]}
        resizeMode="stretch"
        fadeDuration={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mirror: { transform: [{ scaleX: -1 }] },
});
