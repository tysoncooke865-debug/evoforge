import { Text, View } from 'react-native';

import { BF_SCALE_MAX, BF_SCALE_MIN, bodyfatScale, type BodyfatBand } from '@/domain/oracle';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ORACLE_REDESIGN — the body-fat scale: a four-band rail with a marker placed
 * by the pure bodyfatScale() so the label and the marker can never disagree.
 *
 * THE INVARIANT (falsified once in review): the marker rides a LINEAR 4–35%
 * axis, so the coloured segments must be weighted by their bf-range widths —
 * NOT equal quarters — or the dot lands over a different colour than the lit
 * band. Widths below come straight from the band thresholds (10/15/22), and
 * the labels share the same weighted cells so each sits under its own segment.
 */
const BANDS: readonly {
  band: BodyfatBand;
  label: string;
  hi: number;
  colourKey: 'success' | 'accent' | 'warn' | 'danger';
}[] = [
  { band: 'SHREDDED', label: 'SHREDDED', hi: 10, colourKey: 'success' },
  { band: 'ATHLETIC', label: 'ATHLETIC', hi: 15, colourKey: 'accent' },
  { band: 'AVERAGE', label: 'AVERAGE', hi: 22, colourKey: 'warn' },
  { band: 'HIGH', label: 'HIGH', hi: BF_SCALE_MAX, colourKey: 'danger' },
];

// Each band's share of the axis — the same coordinate system the marker uses.
const WIDTHS = BANDS.map((b, i) => b.hi - (i === 0 ? BF_SCALE_MIN : BANDS[i - 1].hi));

export function BodyfatScale({ bfMid }: { bfMid: number }) {
  const colors = useThemeColors();
  const { band, markerPct } = bodyfatScale(bfMid);
  return (
    <View className="mt-s3 w-full">
      <View className="w-full flex-row overflow-hidden rounded-pill" style={{ height: 10 }}>
        {BANDS.map((b, i) => (
          <View key={b.band} style={{ flex: WIDTHS[i], backgroundColor: `${colors[b.colourKey]}66` }} />
        ))}
      </View>
      {/* The marker rides the SAME linear axis — now always over its band. */}
      <View className="w-full" style={{ height: 14, marginTop: -12 }}>
        <View
          style={{
            position: 'absolute',
            left: `${markerPct * 100}%`,
            marginLeft: -6,
            width: 12,
            height: 12,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: colors.text,
            backgroundColor: colors['bg-deep'],
            shadowColor: colors.text,
            shadowOpacity: 0.8,
            shadowRadius: 6,
          }}
        />
      </View>
      <View className="w-full flex-row" style={{ marginTop: 6 }}>
        {BANDS.map((b, i) => (
          <Text
            key={b.band}
            allowFontScaling={false}
            numberOfLines={1}
            style={{
              flex: WIDTHS[i],
              textAlign: 'center',
              fontSize: 9,
              letterSpacing: 0.5,
              color: b.band === band ? colors[b.colourKey] : colors['text-mute'],
              ...pixelFont(false),
            }}
          >
            {b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
