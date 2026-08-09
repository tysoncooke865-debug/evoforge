import { memo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, RadialGradient, Rect, Stop } from 'react-native-svg';

import { INGOT, type ForgeChipValue } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE FORGE CHIP — a struck token, not a Vegas plastic disc.
 *
 * The brief's line is "premium rather than tacky casino styling", and the
 * difference is almost entirely in the edge and the fill. A casino chip is a
 * bright saturated disc with a white inlay; this is a dark forged blank with a
 * coloured RIM, eight cut notches, and a faint radial heat glow from the
 * centre. It reads as metal that came out of a forge, which is the only kind
 * of currency this app has ever had.
 *
 * The denomination decides the rim colour, borrowed from the rarity ladder, so
 * a 500 reads as rare the same way a legendary item does — a scale athletes
 * already know rather than a new one to learn.
 *
 * SVG, not nested Views: eight rotated notches as Views would be eight extra
 * nodes per chip, and a pile renders fourteen chips. One <Svg> is one node.
 */

const NOTCHES = 8;

export const ForgeChip = memo(function ForgeChip({
  value,
  size = 46,
  dimmed = false,
  label = true,
  tone: toneToken,
}: {
  /** Any whole number of coins. Widened from the duel's own ladder so Forge
   *  Drop can rack a 1 and a 15 — denominations a week-long duel never needs
   *  but a board with a five-coin ceiling cannot do without. */
  value: ForgeChipValue | number;
  size?: number;
  /** Unaffordable, or already spent — quiet, never broken-looking. */
  dimmed?: boolean;
  /** The pile hides the number on the chips under the top one. */
  label?: boolean;
  /** A theme TOKEN NAME for denominations outside the duel's ladder. Never a
   *  colour: this component resolves tokens against the live theme and must
   *  keep being the only thing that decides what a chip looks like. */
  tone?: string;
}) {
  const colors = useThemeColors();
  /**
   * THE COLOUR IS THE METAL (v5.1). It used to come from `CHIP_TONE`, which mapped
   * denominations onto the RARITY ladder — 500 rendered 'mythic' so a big chip
   * glowed like a legendary drop. That is the escalating colour ladder a casino
   * uses, and it is the thing the physics-pool brief singles out: value must read
   * from the material, not from an arbitrary hue on a disc.
   *
   * `tone` remains overridable so a caller can still tint for state (owner colour
   * in a shared pool, dimmed when spent); absent that, copper looks like copper.
   */
  const tone = toneToken
    ? (colors[toneToken as keyof typeof colors] ?? toneToken)
    : (INGOT[value as ForgeChipValue]?.hex ?? colors.accent);
  const r = size / 2;
  const notchW = size * 0.16;
  const notchH = size * 0.1;

  return (
    <View style={{ width: size, height: size, opacity: dimmed ? 0.32 : 1 }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id={`heat${value}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={tone} stopOpacity={0.34} />
            <Stop offset="55%" stopColor={tone} stopOpacity={0.08} />
            <Stop offset="100%" stopColor="#04070e" stopOpacity={0.9} />
          </RadialGradient>
        </Defs>
        {/* The rim. */}
        <Circle cx={r} cy={r} r={r - 1} fill="#0b1322" stroke={tone} strokeWidth={size * 0.075} />
        {/* Eight cut notches around the edge — the thing that makes a disc a chip. */}
        <G>
          {Array.from({ length: NOTCHES }, (_, i) => (
            <Rect
              key={i}
              x={r - notchW / 2}
              y={0.5}
              width={notchW}
              height={notchH}
              rx={notchH / 3}
              fill="#04070e"
              transform={`rotate(${(360 / NOTCHES) * i} ${r} ${r})`}
            />
          ))}
        </G>
        {/* The forged face. */}
        <Circle cx={r} cy={r} r={r * 0.68} fill={`url(#heat${value})`} />
        <Circle cx={r} cy={r} r={r * 0.68} fill="none" stroke={tone} strokeWidth={0.75} strokeOpacity={0.55} />
      </Svg>
      {label ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: size * 0.4, color: tone, letterSpacing: 0, ...pixelFont() }}
          >
            {value}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * A PILE. Chips overlap upward and to the right so the stack reads as height,
 * with the newest on top carrying the number.
 *
 * It is capped by `chipPile` upstream: a 2,000-coin pot is forty chips, and
 * forty chips is both a performance problem and an unreadable picture. The
 * NUMBER beside it is always the truth; the pile is the feeling.
 */
export function ForgeChipStack({
  chips,
  size = 28,
  testID,
}: {
  chips: readonly ForgeChipValue[];
  size?: number;
  testID?: string;
}) {
  if (chips.length === 0) return null;
  const step = size * 0.17;
  const spread = size * 0.3;
  // Rows of five, so a big pile grows sideways as well as up instead of
  // becoming one improbable tower.
  const perRow = 5;
  const rows = Math.ceil(chips.length / perRow);
  return (
    <View
      testID={testID}
      style={{
        width: size + spread * (perRow - 1),
        height: size + step * Math.min(perRow, chips.length) + (rows - 1) * size * 0.5,
        justifyContent: 'flex-end',
      }}
    >
      {chips.map((v, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        return (
          <View
            key={`${v}-${i}`}
            style={{
              position: 'absolute',
              left: col * spread,
              bottom: col * step + row * size * 0.5,
              zIndex: i,
            }}
          >
            <ForgeChip value={v} size={size} label={i === chips.length - 1} />
          </View>
        );
      })}
    </View>
  );
}
