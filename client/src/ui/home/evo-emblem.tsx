/**
 * HOME 2026-08-03 — the faint crest behind the Evo Rating.
 *
 * Pure geometry (react-native-svg, already a dependency): a soft radial
 * bloom, a broken HUD ring, two nested hexes and a pair of bowed brackets
 * that read as the mock's laurel without drawing 200 leaves. Nine nodes, no
 * image asset, no animation — it is BACKGROUND, and the rule the neon policy
 * sets (glow is a signal, not decoration) is why every stroke sits under 0.25
 * opacity: it frames the number, it never competes with it.
 *
 * Drawn in the caller's colour so the crest is always the rating's own tint —
 * one accent, never a new one.
 */

import { memo } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Defs, Ellipse, Line, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

/**
 * "This is decoration — never announce it", in the spelling each platform
 * actually reads. react-native-svg passes unknown props straight through to
 * the DOM on web, so the native props alone would write invalid attributes on
 * the <svg> (and React DOM warns about the boolean one) while leaving the
 * crest fully visible to a screen reader — the opposite of the intent.
 *
 * SPREAD IT ON A WRAPPING VIEW, NEVER ON <Svg> ITSELF. `aria-hidden` on an
 * SVG element used to make it VANISH: initSceneJanitor hides aria-hidden
 * nodes under an absolute parent unless they are short, and its size test
 * reads offsetHeight, which does not exist on SVGElement. version-guard.ts is
 * fixed too, but a View keeps this correct regardless of that file.
 */
export const DECORATIVE =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

const VB_W = 240;
const VB_H = 156;
const CX = 120;
const CY = 78;

/** A pointy-top hexagon of radius r about the emblem centre. */
const hex = (r: number): string =>
  [-90, -30, 30, 90, 150, 210]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

export const EvoEmblem = memo(function EvoEmblem({
  width,
  colour,
}: {
  /** Rendered width; the crest keeps its 240:156 aspect. */
  width: number;
  colour: string;
}) {
  const height = Math.round((width * VB_H) / VB_W);
  return (
    <View pointerEvents="none" style={{ width, height }} {...DECORATIVE}>
    <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <Defs>
        <RadialGradient id="evo-emblem-bloom" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor={colour} stopOpacity={0.22} />
          <Stop offset="55%" stopColor={colour} stopOpacity={0.07} />
          <Stop offset="100%" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Ellipse cx={CX} cy={CY} rx={112} ry={72} fill="url(#evo-emblem-bloom)" />

      {/* The broken ring: an arc over the crown and one under the base, open
          at the sides so the crest never closes into a plain circle. */}
      <Path d="M 48.6 52 A 76 76 0 0 1 191.4 52" stroke={colour} strokeOpacity={0.26} strokeWidth={1.5} fill="none" />
      <Path d="M 191.4 104 A 76 76 0 0 1 48.6 104" stroke={colour} strokeOpacity={0.16} strokeWidth={1.5} fill="none" />

      {/* Nested hexes — the futuristic core. */}
      <Polygon points={hex(62)} stroke={colour} strokeOpacity={0.15} strokeWidth={1} fill="none" />
      <Polygon points={hex(50)} stroke={colour} strokeOpacity={0.09} strokeWidth={1} fill="none" />

      {/* Bowed brackets in place of the wreath. */}
      <Path d="M 42 122 Q 14 78 42 34" stroke={colour} strokeOpacity={0.2} strokeWidth={1.5} fill="none" />
      <Path d="M 198 122 Q 226 78 198 34" stroke={colour} strokeOpacity={0.2} strokeWidth={1.5} fill="none" />

      {/* Axis ticks. */}
      <Line x1={50} y1={CY} x2={38} y2={CY} stroke={colour} strokeOpacity={0.3} strokeWidth={1.5} />
      <Line x1={190} y1={CY} x2={202} y2={CY} stroke={colour} strokeOpacity={0.3} strokeWidth={1.5} />
    </Svg>
    </View>
  );
});

/**
 * THE ENERGY RING (2026-08-03, third brief) — the crest's slowly rotating
 * outer band. Static geometry only: the ROTATION is applied by the caller's
 * animated wrapper, so this component re-renders never and the whole effect
 * costs one transform on a driver the hero already runs.
 *
 * Broken into four arcs with index ticks rather than drawn as a closed circle:
 * a solid ring reads as a loading spinner the moment it turns, and a spinner
 * on an athlete's identity is the wrong idea entirely. Gaps make it read as
 * machined hardware.
 */
export const EvoEnergyRing = memo(function EvoEnergyRing({
  size,
  colour,
}: {
  size: number;
  colour: string;
}) {
  const R = 46;
  const arc = (from: number, to: number): string => {
    const p = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(50 + R * Math.cos(a)).toFixed(2)} ${(50 + R * Math.sin(a)).toFixed(2)}`;
    };
    return `M ${p(from)} A ${R} ${R} 0 0 1 ${p(to)}`;
  };
  return (
    <View pointerEvents="none" style={{ width: size, height: size }} {...DECORATIVE}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Four arcs, unequal, so the gaps never line up into a symmetry that
            reads as a dial. */}
        <Path d={arc(-84, -20)} stroke={colour} strokeOpacity={0.24} strokeWidth={1.1} fill="none" />
        <Path d={arc(4, 76)} stroke={colour} strokeOpacity={0.13} strokeWidth={1.1} fill="none" />
        <Path d={arc(98, 154)} stroke={colour} strokeOpacity={0.24} strokeWidth={1.1} fill="none" />
        <Path d={arc(176, 256)} stroke={colour} strokeOpacity={0.13} strokeWidth={1.1} fill="none" />
        {[-84, 4, 98, 176].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <Line
              key={deg}
              x1={50 + (R - 4) * Math.cos(a)}
              y1={50 + (R - 4) * Math.sin(a)}
              x2={50 + (R + 3) * Math.cos(a)}
              y2={50 + (R + 3) * Math.sin(a)}
              stroke={colour}
              strokeOpacity={0.34}
              strokeWidth={1.4}
            />
          );
        })}
      </Svg>
    </View>
  );
});
