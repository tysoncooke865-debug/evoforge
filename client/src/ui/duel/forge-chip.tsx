import { memo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { INGOT, ingotLabel, type ForgeChipValue } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE FORGE INGOT — a pixel-art cast bar, not a disc.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO. This component used to draw a circle
 * with "eight cut notches around the edge — the thing that makes a disc a chip",
 * in its own words. It was carefully made to look premium rather than tacky, and
 * that was never the problem: the v5.1 brief bans the SHAPE, not the finish. "The
 * disc shape plus flat colour-coding is the poker-chip gestalt", and a notched disc
 * is a poker chip however handsomely it is rendered.
 *
 * So it is a cast bar now — a trapezoid with a top face, drawn on a 16x16 pixel
 * grid. Value reads from the MATERIAL plus the stamped numeral, which is the
 * standard all-ages game-currency idiom; colour-by-denomination on a disc is the
 * casino one.
 *
 * AND THE TOP TWO TIERS ARE CUT STONES, not bars: 50 Sapphire, 100 Ruby. The ladder
 * climbs copper -> bronze -> iron -> steel and then changes KIND, so the jump in
 * value is legible from the silhouette before either colour or numeral is read. A
 * gem is a different object; it is not the same shape in a richer hue, which is
 * exactly the line between an RPG currency ladder and a casino one.
 *
 * PIXEL ART, DELIBERATELY, and not just to match the app's aesthetic. Every pixel is
 * an integer-aligned Rect on a 16-unit viewBox, so edges land on unit boundaries and
 * stay hard without needing `shapeRendering` (which react-native-svg does not type).
 * Flat bands are also what keeps six metals distinguishable at 28px in a stack,
 * where a gradient would turn to mud.
 *
 * ONE <Svg> PER INGOT. A pile renders up to fourteen; the rows below are ~40 Rects
 * each, which is one node from React Native's side either way.
 */

const GRID = 16;

/**
 * THE SILHOUETTE, one entry per row: [inset from each side, band].
 *
 * A cast bar seen slightly from above: a narrow top FACE, then the body widening
 * to a base. The asymmetry is the whole reason it reads as an object with mass
 * rather than a rounded rectangle.
 */
type Band = 'face' | 'body' | 'base';
type Silhouette = readonly (readonly [number, Band])[];

const BAR: Silhouette = [
  [5, 'face'],
  [4, 'face'],
  [4, 'face'],
  [3, 'body'],
  [3, 'body'],
  [3, 'body'],
  [2, 'body'],
  [2, 'body'],
  [2, 'body'],
  [1, 'body'],
  [1, 'body'],
  [1, 'base'],
  [1, 'base'],
];

/**
 * A BRILLIANT CUT: table, crown, girdle, then the pavilion tapering to a culet.
 *
 * Nine rows against the bar's thirteen, so a gem sits SHORTER — the silhouette alone
 * tells you it is not a bar, before colour or numeral do. Which is the point: the top
 * of the ladder is a change of KIND, not another hue.
 *
 * The girdle is one pixel from each edge rather than two. The first cut was narrower
 * and prettier, and "100" hung off both sides of the stone — a render caught it that
 * reading the code never would. A denomination you cannot read is not a denomination.
 */
const GEM: Silhouette = [
  [4, 'face'],
  [2, 'face'],
  [1, 'body'],
  [1, 'body'],
  [2, 'body'],
  [3, 'base'],
  [4, 'base'],
  [5, 'base'],
  [6, 'base'],
];

/** Shift a hex toward white or black. Pixel art wants a few flat steps, not a
 *  gradient — three tones is what gives a bar its top, side and shadow. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const ForgeChip = memo(function ForgeChip({
  value,
  size = 46,
  dimmed = false,
  label = true,
  tone: toneToken,
}: {
  /** Any whole number of coins. Wider than the duel's own ladder so a caller can
   *  render a denomination outside it; unknown values fall back to steel. */
  value: ForgeChipValue | number;
  size?: number;
  /** Unaffordable, or already spent — quiet, never broken-looking. */
  dimmed?: boolean;
  /** The pile hides the number on the bars under the top one. */
  label?: boolean;
  /**
   * An OWNER colour for a shared pool, or a theme token. §"Ownership visibility":
   * every ingot in a pool must identify whose it is, and this is how — the metal
   * still says the value, the rim says whose.
   */
  tone?: string;
}) {
  const colors = useThemeColors();
  const metal = INGOT[value as ForgeChipValue] ?? INGOT[25];
  const rim = toneToken ? (colors[toneToken as keyof typeof colors] ?? toneToken) : null;

  const px = size / GRID;
  const top = shade(metal.hex, 0.32);
  const body = metal.hex;
  const base = shade(metal.hex, -0.34);
  const edge = shade(metal.hex, -0.6);

  const shape: Silhouette = metal.kind === 'gem' ? GEM : BAR;
  // Vertically centre in a square box so bars and gems align in one stack.
  const yOff = Math.round((GRID - shape.length) / 2);

  return (
    <View
      style={{ width: size, height: size, opacity: dimmed ? 0.32 : 1 }}
      accessibilityLabel={ingotLabel(value as ForgeChipValue)}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        {shape.map(([inset, band], i) => {
          const y = yOff + i;
          const w = GRID - inset * 2;
          const fill = band === 'face' ? top : band === 'base' ? base : body;
          return (
            <Rect key={`r${i}`} x={inset} y={y} width={w} height={1} fill={fill} />
          );
        })}

        {/* The dark side-edge: one pixel down each flank, which is what stops the
            bar reading as a flat shape and gives it a lit side and a shadowed one. */}
        {shape.map(([inset], i) => (
          <Rect key={`e${i}`} x={GRID - inset - 1} y={yOff + i} width={1} height={1} fill={edge} />
        ))}

        {/* The struck tool mark on a bar; a single facet glint on a gem. Both are
            one pixel row, which is all a 16-grid can spare and all it needs. */}
        {metal.kind === 'gem' ? (
          <Rect x={5} y={yOff + 2} width={2} height={1} fill={shade(metal.hex, 0.7)} />
        ) : (
          <Rect x={6} y={yOff} width={4} height={1} fill={shade(metal.hex, 0.55)} />
        )}

        {/* OWNER RIM. Only when a tone is supplied, so a rack ingot stays plain
            metal and a POOL ingot carries whose it is even while stacked. */}
        {rim ? (
          <>
            <Rect x={1} y={yOff + shape.length} width={GRID - 2} height={1} fill={rim} />
            <Rect x={0} y={yOff + shape.length - 2} width={1} height={2} fill={rim} />
            <Rect x={GRID - 1} y={yOff + shape.length - 2} width={1} height={2} fill={rim} />
          </>
        ) : null}
      </Svg>

      {label ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            allowFontScaling={false}
            style={{
              // Three digits need a smaller stamp or they overrun the material.
              // 100 is the only one today, but the rule is about digit count rather
              // than about 100, so a future denomination cannot reintroduce this.
              fontSize: size * (String(value).length >= 3 ? 0.26 : 0.34),
              // Stamped INTO the metal: the numeral takes its contrast colour from
              // the material rather than a theme token, so it is legible on silver
              // and on copper without either being tinted toward the other.
              color: metal.stamp,
              marginTop: metal.kind === 'gem' ? 0 : size * 0.06,
              ...pixelFont(),
            }}
          >
            {value}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * A PILE. Bars overlap upward and to the right so the stack reads as height, with
 * the newest on top carrying the number.
 *
 * Capped by `chipPile` upstream: a 2,000-coin pool is forty bars, and forty bars is
 * both a performance problem and an unreadable picture. The NUMBER beside it is
 * always the truth; the pile is the feeling.
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
  // Bars stack flatter than discs did — a cast bar sits ON the one below rather
  // than leaning against it, so the step is smaller and the spread wider.
  const step = size * 0.13;
  const spread = size * 0.34;
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
