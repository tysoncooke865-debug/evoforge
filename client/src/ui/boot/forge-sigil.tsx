/**
 * THE FORGE SIGIL — the mark that resolves behind the wordmark during the
 * launch sequence.
 *
 * Pure geometry (react-native-svg, already a dependency): a broken outer ring,
 * a counter-set inner ring, sixteen radial ticks, two nested hexes and an anvil
 * silhouette at the centre. No image asset, no animation of its own — the
 * caller owns the rotation, the scale and the fade, so this component
 * re-renders never and the whole mark costs one transform on a clock the
 * sequence is already running.
 *
 * It speaks the same visual language as `ui/home/evo-emblem.tsx` on purpose:
 * broken arcs, nested hexes, axis ticks. The screen an athlete sees first
 * should be recognisably the same object as the crest behind their rating.
 *
 * RINGS ARE BROKEN, NOT CLOSED. A complete circle reads as a loading spinner
 * the instant it turns, and a spinner is exactly what this replaces.
 */

import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { DECORATIVE } from '@/ui/home/evo-emblem';

const CX = 100;
const CY = 100;

/** A pointy-top hexagon of radius r about the centre. */
const hex = (r: number): string =>
  [-90, -30, 30, 90, 150, 210]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

/** An arc between two angles at radius r. */
const arc = (r: number, from: number, to: number): string => {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`;
  };
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${p(from)} A ${r} ${r} 0 ${large} 1 ${p(to)}`;
};

export const ForgeSigil = memo(function ForgeSigil({
  size,
  colour,
  halo,
  /** 0–1; the caller's stage progress. Only used to weight the stroke alpha. */
  intensity = 1,
}: {
  size: number;
  colour: string;
  halo: string;
  intensity?: number;
}) {
  const a = (base: number) => Math.max(0, Math.min(1, base * intensity));
  return (
    <View pointerEvents="none" style={{ width: size, height: size }} {...DECORATIVE}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id="forge-halo" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={halo} stopOpacity={a(0.2)} />
            <Stop offset="58%" stopColor={halo} stopOpacity={a(0.06)} />
            <Stop offset="100%" stopColor={halo} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Circle cx={CX} cy={CY} r={96} fill="url(#forge-halo)" />

        {/* The outer ring: four unequal arcs, so the gaps never line up into a
            symmetry the eye reads as a dial. */}
        <Path d={arc(88, -86, -14)} stroke={colour} strokeOpacity={a(0.5)} strokeWidth={1.4} fill="none" />
        <Path d={arc(88, 6, 74)} stroke={colour} strokeOpacity={a(0.24)} strokeWidth={1.4} fill="none" />
        <Path d={arc(88, 96, 166)} stroke={colour} strokeOpacity={a(0.5)} strokeWidth={1.4} fill="none" />
        <Path d={arc(88, 186, 262)} stroke={colour} strokeOpacity={a(0.24)} strokeWidth={1.4} fill="none" />

        {/* Counter-set inner ring — the caller spins the two at different
            rates, which is what makes it read as machinery. */}
        <Path d={arc(66, -40, 84)} stroke={colour} strokeOpacity={a(0.3)} strokeWidth={1} fill="none" />
        <Path d={arc(66, 130, 250)} stroke={colour} strokeOpacity={a(0.3)} strokeWidth={1} fill="none" />

        {/* Sixteen radial ticks. */}
        {Array.from({ length: 16 }, (_, i) => {
          const deg = i * 22.5;
          const r = (deg * Math.PI) / 180;
          const long = i % 4 === 0;
          return (
            <Line
              key={deg}
              x1={CX + (long ? 74 : 78) * Math.cos(r)}
              y1={CY + (long ? 74 : 78) * Math.sin(r)}
              x2={CX + 84 * Math.cos(r)}
              y2={CY + 84 * Math.sin(r)}
              stroke={colour}
              strokeOpacity={a(long ? 0.6 : 0.28)}
              strokeWidth={long ? 1.6 : 1}
            />
          );
        })}

        <Polygon points={hex(50)} stroke={colour} strokeOpacity={a(0.22)} strokeWidth={1} fill="none" />
        <Polygon points={hex(38)} stroke={colour} strokeOpacity={a(0.12)} strokeWidth={1} fill="none" />

        {/* THE ANVIL, in the app's stepped pixel idiom — flat axis-aligned
            edges, never a curve. It is what the hammer is about to hit, and it
            is drawn small and low so the wordmark forged above it has the
            middle of the sigil to itself. */}
        <Path
          d="M 80 146 H 120 V 139 H 112 V 134 H 88 V 139 H 80 Z M 91 146 V 154 H 87 V 159 H 113 V 154 H 109 V 146 Z"
          fill={colour}
          fillOpacity={a(0.45)}
        />
      </Svg>
    </View>
  );
});

/**
 * THE HAMMER. Also stepped, also axis-aligned: a head with a chamfered face, a
 * collar and a haft. It exists for ~250ms and then it is light, so it is drawn
 * rather than modelled — the silhouette is the whole performance.
 *
 * Its own SVG (not a composed stack of Views) so the caller animates ONE node
 * and the proportions cannot drift apart under a transform.
 */
export const ForgeHammer = memo(function ForgeHammer({
  size,
  metal,
  edge,
}: {
  /** Width; the hammer keeps its 100:132 aspect. */
  size: number;
  metal: string;
  edge: string;
}) {
  return (
    <View pointerEvents="none" style={{ width: size, height: (size * 132) / 100 }} {...DECORATIVE}>
      <Svg width={size} height={(size * 132) / 100} viewBox="0 0 100 132">
        {/* The haft. */}
        <Path d="M 44 46 H 56 V 130 H 44 Z" fill={metal} fillOpacity={0.85} />
        <Path d="M 44 46 H 48 V 130 H 44 Z" fill={edge} fillOpacity={0.5} />
        {/* The collar. */}
        <Path d="M 38 40 H 62 V 50 H 38 Z" fill={edge} fillOpacity={0.8} />
        {/* The head: a stepped block with a bright striking face on the left. */}
        <Path d="M 8 6 H 92 V 40 H 8 Z M 14 40 H 86 V 46 H 14 Z" fill={metal} />
        <Path d="M 8 6 H 22 V 40 H 8 Z" fill={edge} />
        <Path d="M 8 6 H 92 V 11 H 8 Z" fill={edge} fillOpacity={0.75} />
      </Svg>
    </View>
  );
});
