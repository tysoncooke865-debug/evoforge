import { View } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';

/**
 * FUEL_REDESIGN — the one thin bar the page repeats (calories, three macros,
 * the protein bonus). The established inline idiom, made a component because
 * this screen draws five of them: pill track on surface-3, pill fill in the
 * caller's colour, minWidth 4 so logged progress never renders 0px.
 */
export function ThinBar({
  pct,
  color,
  height = 5,
  testID,
}: {
  /** 0–100; clamped here so callers can pass raw arithmetic. */
  pct: number;
  color: string;
  height?: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const w = Math.max(0, Math.min(100, pct));
  return (
    <View
      className="w-full overflow-hidden rounded-pill"
      style={{ height, backgroundColor: colors['surface-3'] }}
      testID={testID}
    >
      <View
        style={{
          width: `${w}%`,
          minWidth: w > 0 ? 4 : 0,
          height: '100%',
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
