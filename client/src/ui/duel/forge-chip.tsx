import { memo } from 'react';
import { Image, Platform, Text, View, type ImageStyle } from 'react-native';

import { INGOT, ingotLabel, type ForgeChipValue } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';

/**
 * THE FORGE MATERIALS — generated pixel art, not a drawn disc.
 *
 * WHAT THIS REPLACED, TWICE. It began as a circle with "eight cut notches around the
 * edge — the thing that makes a disc a chip", in its own words: carefully made, and
 * a poker chip regardless, because the v5.1 brief bans the SHAPE and not the finish.
 * The first replacement drew a cast bar by hand as one Rect per pixel row and read
 * as a stepped pyramid — something only visible by rendering it, and four
 * silhouettes did not fix it. These are generated instead
 * (`scripts/forge-materials-gen.mjs`), and carry the shading and silhouette weight
 * a row-per-inset trapezoid could not.
 *
 * THE LADDER: copper 5, bronze 10, iron 15, steel 25, then it changes KIND —
 * sapphire 50, ruby 100. Value reads from the material plus the stamped numeral,
 * which is the standard all-ages currency idiom; colour-by-denomination on a disc is
 * the casino one. The change of kind at the top makes the jump legible from the
 * silhouette before either colour or number is read.
 *
 * THE NUMERAL IS NOT BAKED IN. It is stamped at render time so it scales with the
 * component and stays legible from 28px to 72px, and so a denomination can be
 * retuned without regenerating art.
 *
 * WHAT A BAKED SPRITE COSTS: one size and one colour. `imageRendering: pixelated`
 * handles the size — a 32px source scales up in hard squares rather than blurring.
 * The colour is the real trade: owner identification for the shared pool can no
 * longer be drawn INTO the piece, so it is composited around it below.
 */

/**
 * Web-only, and cast, because `imageRendering` is a CSS property React Native does
 * not type. The repo already does this in five places (arena card-row, battle-intro,
 * avatar); matching it rather than inventing a sixth spelling.
 */
const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

const SPRITE = {
  5: require('../../../assets/forge-materials/copper-5.png'),
  10: require('../../../assets/forge-materials/bronze-10.png'),
  15: require('../../../assets/forge-materials/iron-15.png'),
  25: require('../../../assets/forge-materials/steel-25.png'),
  50: require('../../../assets/forge-materials/sapphire-50.png'),
  100: require('../../../assets/forge-materials/ruby-100.png'),
} as const;

export const ForgeChip = memo(function ForgeChip({
  value,
  size = 46,
  dimmed = false,
  label = true,
  tone,
}: {
  /** Any whole number of coins. Outside the ladder falls back to steel, so a caller
   *  rendering an odd denomination gets a plausible object rather than nothing. */
  value: ForgeChipValue | number;
  size?: number;
  /** Unaffordable, or already spent — quiet, never broken-looking. */
  dimmed?: boolean;
  /** The pile hides the number on the pieces under the top one. */
  label?: boolean;
  /**
   * OWNER COLOUR for a shared pool. §"Ownership visibility": every piece in a pool
   * must identify whose it is, legibly even while stacked. A baked sprite cannot
   * carry it, so it is an underline plus two corner ticks drawn around the art —
   * which survives overlap better than a full rim would, because the piece above
   * covers the middle of the one below and never its corners.
   */
  tone?: string;
}) {
  const metal = INGOT[value as ForgeChipValue] ?? INGOT[25];
  const src = SPRITE[value as ForgeChipValue] ?? SPRITE[25];
  const tick = Math.max(2, Math.round(size * 0.07));

  return (
    <View
      style={{ width: size, height: size, opacity: dimmed ? 0.32 : 1 }}
      accessibilityLabel={ingotLabel(value as ForgeChipValue)}
    >
      <Image
        source={src}
        // A 32px source at 72px must scale in hard squares. Without this the
        // browser smooths it and the whole point of pixel art is gone.
        style={[{ width: size, height: size }, PIXELATED]}
        resizeMode="contain"
      />

      {tone ? (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: size * 0.12, right: size * 0.12, bottom: 0,
              height: tick, backgroundColor: tone, borderRadius: 1,
            }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: size * 0.12, bottom: 0, width: tick, height: tick * 2.2, backgroundColor: tone }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', right: size * 0.12, bottom: 0, width: tick, height: tick * 2.2, backgroundColor: tone }}
          />
        </>
      ) : null}

      {label ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            allowFontScaling={false}
            style={{
              // Three digits need a smaller stamp or they overrun the piece. The rule
              // is about DIGIT COUNT rather than about 100, so a future denomination
              // cannot reintroduce the overflow a render caught the first time.
              fontSize: size * (String(value).length >= 3 ? 0.24 : 0.3),
              // WHITE ON A HARD DARK OUTLINE, for every material.
              //
              // `metal.stamp` was a per-material contrast colour picked for the flat
              // SVG this replaced, and it does not survive real sprites: dark-on-steel
              // vanished against a bright bar with a busy top face, and dark-on-copper
              // was barely better. One light colour with an outline is legible on all
              // six — a numeral you cannot read is not a denomination.
              color: '#FFFFFF',
              // A gem's mass sits high and a bar's sits low; the numeral follows.
              marginTop: metal.kind === 'gem' ? -size * 0.04 : size * 0.08,
              textShadowColor: 'rgba(0,0,0,0.95)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 3,
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
 * A PILE. Pieces overlap upward and to the right so the stack reads as height, with
 * the newest on top carrying the number.
 *
 * Capped by `chipPile` upstream: a 2,000-coin pool is forty pieces, and forty is both
 * a performance problem and an unreadable picture. The NUMBER beside it is always the
 * truth; the pile is the feeling.
 */
export function ForgeChipStack({
  chips,
  size = 28,
  tone,
  testID,
}: {
  chips: readonly ForgeChipValue[];
  size?: number;
  /** Owner colour, applied to every piece in the pile. */
  tone?: string;
  testID?: string;
}) {
  if (chips.length === 0) return null;
  // TUNED FOR BARS, NOT DISCS. 0.34 spread was right for a narrow trapezoid; these
  // sprites are wide and low, so at that offset eight of them rendered as one smear.
  // Four per row rather than five, and each sits further right and only slightly up.
  const step = size * 0.1;
  const spread = size * 0.62;
  const perRow = 4;
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
            <ForgeChip value={v} size={size} tone={tone} label={i === chips.length - 1} />
          </View>
        );
      })}
    </View>
  );
}
