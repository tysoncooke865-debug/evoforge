/**
 * EVO RADAR (Tyson, 2026-07-19) — the Home character wheel, now sourced from
 * the SAME four pillar scores that build the Evo Rating
 * (evo_rating_current.{size,aesthetics,strength,cardio}_score, exactly what the
 * EVO CORE card shows). Before this the radar drew five legacy live stats from
 * calculateAvatarStats() — a different scoring system — so the numbers on the
 * wheel contradicted the Evo Rating beside them. Now they line up by construction.
 *
 * It also overlays a PROJECTION: where those pillars go after a chosen block of
 * consistent training (dashed polygon, projection.ts). Honest by house doctrine —
 * a diminishing-returns headroom model, never a promise, never past 100.
 *
 * Fallback: before the first Evo review (no row yet) there are no pillars to
 * show, so it renders the legacy live radar passed in as `fallbackStats` — no
 * regression for brand-new athletes; the EVO CORE card runs the first review.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { useMomentum } from '@/data/progression/use-forge';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import {
  consistencyFromMomentum,
  projectPillars,
  type PillarScores,
} from '@/domain/progression/projection';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { StatRadar, type RadarStat } from '@/ui/character/stat-radar';

const HORIZONS = [8, 12, 16] as const;

// Same axis order as EvoCore's PILLAR_ROWS so the two read as one system.
const AXES: readonly (readonly [key: keyof PillarScores, label: string])[] = [
  ['size', 'SIZE'],
  ['aesthetics', 'AES'],
  ['strength', 'STR'],
  ['cardio', 'CARDIO'],
];

export function EvoRadar({ fallbackStats }: { fallbackStats: RadarStat[] }) {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();
  const { momentum } = useMomentum();
  const [weeks, setWeeks] = useState<number>(12);

  const row = current.data as Record<string, unknown> | null;

  // No new-progression backend, still loading, or no confirmed rating yet →
  // the legacy live radar (unchanged behaviour), no projection.
  if (!progressionFeatures.newProgressionEnabled || current.isPending || !row) {
    return <StatRadar stats={fallbackStats} />;
  }

  // Math.floor to MATCH the EVO CORE card exactly (it floors too) — the whole
  // point is that the wheel and the card show the same integers.
  const pillars: PillarScores = {
    size: Math.floor(Number(row.size_score ?? 1)),
    aesthetics: Math.floor(Number(row.aesthetics_score ?? 1)),
    strength: Math.floor(Number(row.strength_score ?? 1)),
    cardio: Math.floor(Number(row.cardio_score ?? 1)),
  };

  const stats: RadarStat[] = AXES.map(([key, label]) => ({ label, value: pillars[key] }));
  const projected = projectPillars(pillars, weeks, consistencyFromMomentum(momentum?.current ?? 0));
  const overlay: RadarStat[] = AXES.map(([key, label]) => ({ label, value: projected[key] }));

  return (
    <View>
      <StatRadar stats={stats} overlay={overlay} overlayLabel={`+${weeks} WKS`} />
      {/* The horizon selector — "predicted after X of consistent training". */}
      <View className="mt-s2 flex-row items-center justify-center gap-s2">
        <Text
          className="text-2xs text-text-mute"
          allowFontScaling={false}
          style={{ letterSpacing: 0.5, ...pixelFont(false) }}
        >
          PROJECT
        </Text>
        {HORIZONS.map((h) => {
          const active = h === weeks;
          return (
            <Pressable
              key={h}
              onPress={() => setWeeks(h)}
              accessibilityRole="button"
              testID={`radar-horizon-${h}`}
              className="rounded-pill border px-s2"
              style={{
                minHeight: 34,
                justifyContent: 'center',
                borderColor: active ? `${colors.epic}99` : colors.border,
                backgroundColor: active ? 'rgba(168,85,247,0.12)' : 'transparent',
              }}
            >
              <Text
                allowFontScaling={false}
                style={{ fontSize: 10, color: active ? colors.epic : colors['text-mute'], ...pixelFont() }}
              >
                {h}W
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mt-s1 text-center text-2xs text-text-mute">
        Dashed = where your pillars head after {weeks} weeks of consistent training.
      </Text>
    </View>
  );
}
