import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';

import {
  PixelBell,
  PixelBolt,
  PixelCamera,
  PixelDumbbell,
  PixelFlame,
  PixelLock,
  PixelPeople,
  PixelScales,
  PixelSearch,
  PixelShield,
  PixelTarget,
} from './pixel-icons';

/**
 * THE ICON REGISTRY (2026-08-11, docs/ICON_AUDIT.md).
 *
 * ONE name, ONE icon, wherever it is drawn. Before this, the same concept was
 * spelled three ways across the app — `⚡` in one file, `<PixelBolt />` in
 * another, and a bare `<Text>` with a colour emoji in a third — which is how a
 * UI ends up looking assembled rather than designed.
 *
 * ---- TWO KINDS OF ICON, AND WHY THAT IS NOT A COMPROMISE ----
 *
 * The registry serves both:
 *
 *   GLYPH   a hand-authored pixel grid rendered as SVG (ui/core/pixel-icons).
 *           Tintable, resolution-independent, zero bytes. The right answer for
 *           functional symbols at 10–20px, where the colour must follow the
 *           active/inactive state and a 4:1 raster downscale would be mush.
 *   ART     a PixelLab-generated PNG (assets/pixel-lab/icons). One colour, one
 *           size — and worth it exactly when the COLOUR IS THE INFORMATION:
 *           gold beside silver beside bronze cannot be a tint of one grid.
 *
 * The caller does not choose. It asks for `medal-gold` or `lock` and the
 * registry knows which kind that is. That is the point of having one: the
 * decision lives in a table that can be reviewed, not in 40 call sites.
 *
 * ---- PIXEL-PRESERVING RENDERING ----
 *
 * Every raster is drawn with nearest-neighbour scaling. A bilinear filter on
 * 32×32 pixel art produces exactly the soft mush the whole style exists to
 * avoid, and browsers default to it.
 *
 * ---- ACCESSIBILITY ----
 *
 * `label` is required for a standalone icon and explicitly `null`-able for a
 * decorative one sitting beside its own text. Making the caller say which
 * costs one prop and prevents both failure modes: an unlabelled icon that a
 * screen reader skips, and a labelled one that reads the same word twice
 * because there is already a caption underneath it.
 */

/** Rasters, resolved once. `require` keeps them in the bundle graph, so a
 *  missing file is a BUILD error rather than a blank square in production. */
const ART = {
  trophy: require('../../../assets/pixel-lab/icons/status/trophy.png'),
  'medal-gold': require('../../../assets/pixel-lab/icons/status/medal-gold.png'),
  'medal-silver': require('../../../assets/pixel-lab/icons/status/medal-silver.png'),
  'medal-bronze': require('../../../assets/pixel-lab/icons/status/medal-bronze.png'),
  badge: require('../../../assets/pixel-lab/icons/status/badge.png'),
  crown: require('../../../assets/pixel-lab/icons/status/crown.png'),
  ghost: require('../../../assets/pixel-lab/icons/challenges/ghost.png'),
} as const;

const GLYPH = {
  lock: PixelLock,
  search: PixelSearch,
  scales: PixelScales,
  bolt: PixelBolt,
  camera: PixelCamera,
  flame: PixelFlame,
  people: PixelPeople,
  bell: PixelBell,
  shield: PixelShield,
  target: PixelTarget,
  dumbbell: PixelDumbbell,
} as const;

export type ArtIconName = keyof typeof ART;
export type GlyphIconName = keyof typeof GLYPH;
export type IconName = ArtIconName | GlyphIconName;

export const ART_ICON_NAMES = Object.keys(ART) as ArtIconName[];
export const GLYPH_ICON_NAMES = Object.keys(GLYPH) as GlyphIconName[];
export const ICON_NAMES: IconName[] = [...ART_ICON_NAMES, ...GLYPH_ICON_NAMES];

export const isArtIcon = (name: IconName): name is ArtIconName => name in ART;

/** The states an icon is drawn in. Colour is decided HERE, not by 40 callers,
 *  which is what keeps cyan meaning "selected" everywhere. */
export type IconState = 'default' | 'active' | 'inactive' | 'disabled';

export interface IconProps {
  name: IconName;
  size?: number;
  state?: IconState;
  /** Overrides the state's colour. GLYPH only — art carries its own palette. */
  color?: string;
  /** The screen-reader name. `null` = decorative, and the caller is asserting
   *  the meaning is already carried by adjacent text. */
  label: string | null;
  testID?: string;
}

export function Icon({ name, size = 18, state = 'default', color, label, testID }: IconProps) {
  const colors = useThemeColors();
  const a11y =
    label === null
      ? ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const)
      : ({ accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label });

  if (isArtIcon(name)) {
    return (
      <View {...a11y} style={{ opacity: state === 'disabled' ? 0.35 : 1 }} testID={testID ?? `icon-${name}`}>
        <Image
          source={ART[name]}
          style={{ width: size, height: size }}
          // NEAREST NEIGHBOUR, both platforms. Without this a 32px source at
          // 16px is bilinear-averaged and every hard pixel edge is gone —
          // the one thing this art is for.
          contentFit="contain"
          {...(Platform.OS === 'web'
            ? { style: { width: size, height: size, imageRendering: 'pixelated' } as never }
            : {})}
        />
      </View>
    );
  }

  const Glyph = GLYPH[name];
  const tint =
    color ??
    (state === 'active'
      ? colors.accent
      : state === 'inactive'
        ? colors['text-mute']
        : state === 'disabled'
          ? colors.border
          : colors['text-dim']);
  return (
    <View {...a11y}>
      <Glyph size={size} color={tint} testID={testID ?? `icon-${name}`} />
    </View>
  );
}

/**
 * The last-resort fallback. Only reachable if a name is forced past the type
 * system (a value from the server, a stale string in a config). It renders a
 * neutral placeholder rather than crashing the screen it is on — a missing
 * icon must never take a workout down with it.
 */
export function IconOrNothing(props: IconProps) {
  if (!ICON_NAMES.includes(props.name)) {
    return (
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="icon-missing">
        {' '}
      </Text>
    );
  }
  return <Icon {...props} />;
}
