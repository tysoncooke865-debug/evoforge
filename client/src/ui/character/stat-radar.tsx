import { useState } from 'react';
import { Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';

import { useThemeColors } from '@/theme/use-theme';

/**
 * The character radar: five attributes on a pentagon, the RPG stat wheel.
 * One series, one hue (single-series rule -- the card title names it);
 * recessive grid rings, values shown at the vertices in text tokens.
 */
export interface RadarStat {
  label: string;
  value: number; // 0-100
}

export function StatRadar({
  stats,
  size = 260,
  overlay,
  overlayLabel = 'PROJECTED',
  baseLabel = 'NOW',
}: {
  stats: RadarStat[];
  size?: number;
  /** PROJECTION (2026-07-19): a second, dashed polygon — e.g. the predicted
   *  pillars after a consistent training block. Values must align to `stats`
   *  (same axes, same order). Drawn behind the live polygon so both read. */
  overlay?: RadarStat[];
  overlayLabel?: string;
  baseLabel?: string;
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const s = Math.min(size, width || size);
  const cx = s / 2;
  const cy = s / 2 + 6;
  const radius = s / 2 - 34;
  const n = stats.length;

  const point = (i: number, r: number): [number, number] => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  const polygonFor = (r: (i: number) => number) =>
    stats.map((_, i) => point(i, r(i)).join(',')).join(' ');

  const valuePoly = polygonFor((i) => (Math.max(0, Math.min(100, stats[i].value)) / 100) * radius);
  const overlayPoly =
    overlay && overlay.length === n
      ? polygonFor((i) => (Math.max(0, Math.min(100, overlay[i].value)) / 100) * radius)
      : null;

  return (
    <View onLayout={onLayout} className="items-center">
      {width > 0 ? (
        <Svg width={s} height={s}>
          {[0.33, 0.66, 1].map((f) => (
            <Polygon
              key={f}
              points={polygonFor(() => radius * f)}
              fill="none"
              stroke={colors['border-soft']}
              strokeWidth={1}
            />
          ))}
          {stats.map((_, i) => {
            const [x, y] = point(i, radius);
            return (
              <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={colors['border-soft']} strokeWidth={1} />
            );
          })}

          {/* Projected pillars (behind) — dashed, faint, in the Evo hue. */}
          {overlayPoly ? (
            <Polygon
              points={overlayPoly}
              fill={`${colors.epic}1f`}
              stroke={colors.epic}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : null}

          <Polygon points={valuePoly} fill={`${colors.accent}2b`} stroke={colors.accent} strokeWidth={2} />
          {stats.map((st, i) => {
            const [x, y] = point(i, (Math.max(0, Math.min(100, st.value)) / 100) * radius);
            return <Circle key={st.label} cx={x} cy={y} r={3.5} fill={colors.accent} stroke={colors.surface} strokeWidth={1.5} />;
          })}

          {stats.map((st, i) => {
            const [x, y] = point(i, radius + 18);
            return (
              <SvgText
                key={st.label}
                x={x}
                y={y}
                fontSize={9}
                fontWeight="bold"
                fill={colors['text-mute']}
                textAnchor="middle"
              >
                {st.label}
              </SvgText>
            );
          })}
        </Svg>
      ) : null}
      {/* When projecting, the axis legend shows now → projected; otherwise the
          plain per-axis value. */}
      <View className="mt-s1 flex-row flex-wrap justify-center gap-s3">
        {stats.map((st, i) => (
          <View key={st.label} className="flex-row items-baseline gap-s1">
            <RNText className="text-2xs text-text-mute">{st.label}</RNText>
            <RNText className="text-sm font-bold text-text">{Math.round(st.value)}</RNText>
            {overlayPoly ? (
              <RNText className="text-2xs font-bold" style={{ color: colors.epic }}>
                →{Math.round(overlay![i].value)}
              </RNText>
            ) : null}
          </View>
        ))}
      </View>
      {overlayPoly ? (
        <View className="mt-s1 flex-row items-center justify-center gap-s3">
          <View className="flex-row items-center gap-s1">
            <View style={{ width: 14, height: 0, borderTopWidth: 2, borderColor: colors.accent }} />
            <RNText className="text-2xs text-text-mute">{baseLabel}</RNText>
          </View>
          <View className="flex-row items-center gap-s1">
            <View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.epic }} />
            <RNText className="text-2xs text-text-mute">{overlayLabel}</RNText>
          </View>
        </View>
      ) : null}
    </View>
  );
}
