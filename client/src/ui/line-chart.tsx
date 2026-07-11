import { line as d3line, curveMonotoneX } from 'd3-shape';
import { useMemo, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line as SvgLine, Path, Text as SvgText } from 'react-native-svg';

import tokens from '@/theme/tokens';

/**
 * The hand-rolled time-series line chart the plan specifies (react-native-svg
 * + d3-shape) -- the app only draws simple single-series lines, and this keeps
 * Victory's CanvasKit wasm off the web bundle.
 *
 * Dataviz method notes: single series, so no legend (the card title names it)
 * and one hue -- the accent, 3:1+ on the surface. 2px line, recessive grid,
 * selective labels (first/last x, ~4 y ticks, the active point only), and a
 * touch/hover layer with a crosshair + tooltip; the whole plot is the hit
 * target, larger than any mark.
 */

export interface ChartPoint {
  /** Position on the time axis (ms epoch or any monotonic number). */
  x: number;
  y: number;
  label: string; // tooltip line, e.g. "2026-07-11 · 77.4kg"
}

interface LineChartProps {
  points: ChartPoint[];
  height?: number;
  formatY?: (y: number) => string;
  /** Axis end labels; defaults to the first/last point labels' date part. */
  xStart?: string;
  xEnd?: string;
}

const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

export function LineChart({ points, height = 180, formatY = (y) => String(y), xStart, xEnd }: LineChartProps) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 2 || width === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const ySpan = yMax - yMin || 1;
    // Pad the y-domain 10% so the line never kisses the frame.
    const y0 = yMin - ySpan * 0.1;
    const y1 = yMax + ySpan * 0.1;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
    const sy = (y: number) => PAD.top + (1 - (y - y0) / (y1 - y0)) * plotH;
    const path = d3line<ChartPoint>()
      .x((p) => sx(p.x))
      .y((p) => sy(p.y))
      .curve(curveMonotoneX)(points);
    const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => y0 + t * (y1 - y0));
    return { sx, sy, path: path ?? '', ticks, plotH };
  }, [points, width, height]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length < 2) {
    return (
      <View className="items-center justify-center rounded-md border border-border-soft p-s6" style={{ height }}>
        <Text className="text-xs text-text-mute">Not enough data yet — two readings make a line.</Text>
      </View>
    );
  }

  const activePoint = active !== null ? points[active] : null;

  const locate = (evtX: number) => {
    if (!geometry) return;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geometry.sx(p.x) - evtX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  };

  return (
    <View onLayout={onLayout}>
      {width > 0 && geometry ? (
        <Pressable
          onPressIn={(e) => locate(e.nativeEvent.locationX)}
          onTouchMove={(e) => locate(e.nativeEvent.locationX)}
          onHoverIn={undefined}
          onPressOut={() => setActive(null)}
        >
          <Svg width={width} height={height}>
            {geometry.ticks.map((t) => (
              <SvgLine
                key={t}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={geometry.sy(t)}
                y2={geometry.sy(t)}
                stroke={tokens.colors['border-soft']}
                strokeWidth={1}
              />
            ))}
            {geometry.ticks.map((t) => (
              <SvgText
                key={`l${t}`}
                x={PAD.left - 6}
                y={geometry.sy(t) + 3}
                fontSize={9}
                fill={tokens.colors['text-mute']}
                textAnchor="end"
              >
                {formatY(t)}
              </SvgText>
            ))}
            <Path d={geometry.path} stroke={tokens.colors.accent} strokeWidth={2} fill="none" />

            {activePoint ? (
              <>
                <SvgLine
                  x1={geometry.sx(activePoint.x)}
                  x2={geometry.sx(activePoint.x)}
                  y1={PAD.top}
                  y2={height - PAD.bottom}
                  stroke={tokens.colors['border-strong']}
                  strokeWidth={1}
                />
                {/* >=8px marker with a surface ring so it reads over the line */}
                <Circle
                  cx={geometry.sx(activePoint.x)}
                  cy={geometry.sy(activePoint.y)}
                  r={5}
                  fill={tokens.colors.accent}
                  stroke={tokens.colors.surface}
                  strokeWidth={2}
                />
              </>
            ) : (
              <Circle
                cx={geometry.sx(points[points.length - 1].x)}
                cy={geometry.sy(points[points.length - 1].y)}
                r={4}
                fill={tokens.colors.accent}
              />
            )}

            <SvgText x={PAD.left} y={height - 6} fontSize={9} fill={tokens.colors['text-mute']}>
              {xStart ?? points[0].label.split(' ·')[0]}
            </SvgText>
            <SvgText
              x={width - PAD.right}
              y={height - 6}
              fontSize={9}
              fill={tokens.colors['text-mute']}
              textAnchor="end"
            >
              {xEnd ?? points[points.length - 1].label.split(' ·')[0]}
            </SvgText>
          </Svg>
        </Pressable>
      ) : null}

      {/* Tooltip in text tokens, never the series color (dataviz rule). */}
      <View className="h-s5">
        {activePoint ? <Text className="text-xs text-text-dim">{activePoint.label}</Text> : null}
      </View>
    </View>
  );
}
