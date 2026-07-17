import { Text, View } from 'react-native';

import type { WeeklyContract } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelBars, PixelClock, PixelDumbbell, PixelHeart } from '@/ui/core/pixel-icons';

/**
 * HOME_REDESIGN §7 — TRAINING OVERVIEW, this week (Monday-start, the
 * weeklyContract window). Four metrics, all real: workouts done/target from
 * the contract, sets and cardio minutes and XP from periodTotals over the
 * same window. Progress bars only where a real target exists (workouts) —
 * no fabricated goals, no calorie-goal fiction (only per-session estimates
 * exist). Empty week reads 0, honest; no data at all reads —.
 *
 * Plain views, no chart library. The M–S pips reuse the contract's states.
 */
export function TrainingOverview({
  contract,
  weekSets,
  weekCardioMinutes,
  weekXp,
  hasSchedule,
}: {
  contract: WeeklyContract;
  weekSets: number;
  weekCardioMinutes: number;
  weekXp: number;
  hasSchedule: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-xl border p-s4"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          TRAINING OVERVIEW
        </Text>
        <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }}>
          THIS WEEK
        </Text>
      </View>

      <View className="mt-s3 flex-row flex-wrap" style={{ gap: 12 }}>
        <Metric
          icon={<PixelDumbbell size={15} color={colors['text-dim']} />}
          label="WORKOUTS"
          value={hasSchedule ? `${contract.done} / ${contract.target}` : String(contract.done)}
          pct={hasSchedule && contract.target > 0 ? (contract.done / contract.target) * 100 : null}
          testID="overview-workouts"
        />
        <Metric
          icon={<PixelBars size={15} color={colors['text-dim']} />}
          label="SETS"
          value={String(weekSets)}
          pct={null}
          testID="overview-sets"
        />
        <Metric
          icon={<PixelHeart size={15} color={colors['text-dim']} />}
          label="CARDIO"
          value={`${Math.trunc(weekCardioMinutes)} MIN`}
          pct={null}
          testID="overview-cardio"
        />
        <Metric
          icon={<PixelClock size={15} color={colors['text-dim']} />}
          label="XP EARNED"
          value={`+${weekXp}`}
          pct={null}
          testID="overview-xp"
        />
      </View>

      {hasSchedule ? (
        <View className="mt-s3 flex-row justify-between">
          {contract.pips.map((pip, i) => (
            <DayDot key={pip.date} letter={'MTWTFSS'[i]} state={pip.state} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Metric({
  icon,
  label,
  value,
  pct,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  pct: number | null;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexGrow: 1, flexBasis: '44%', minWidth: 0 }} testID={testID}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        {icon}
        <Text
          className="text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}
        >
          {label}
        </Text>
      </View>
      <Text className="mt-s1 text-text" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0, ...pixelFont() }}>
        {value}
      </Text>
      {pct !== null ? (
        <View className="mt-s1 overflow-hidden rounded-pill" style={{ height: 4, backgroundColor: colors['surface-3'] }}>
          <View
            style={{
              width: `${Math.min(100, pct)}%`,
              minWidth: pct > 0 ? 4 : 0,
              height: '100%',
              borderRadius: 999,
              backgroundColor: colors.accent,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** One day of the week strip — the contract's own state palette. */
function DayDot({ letter, state }: { letter: string; state: string }) {
  const colors = useThemeColors();
  const palette: Record<string, { border: string; bg: string; text: string }> = {
    completed: { bg: `${colors.success}26`, border: colors.success, text: colors.success },
    missed: { bg: 'transparent', border: `${colors.danger}66`, text: `${colors.danger}99` },
    pending: { bg: `${colors.accent}1f`, border: colors.accent, text: colors.accent },
    rest: { bg: 'transparent', border: colors.border, text: colors['text-mute'] },
    future: { bg: 'transparent', border: colors.border, text: colors['text-dim'] },
  };
  const c = palette[state] ?? palette.future;
  return (
    <View
      className="items-center justify-center rounded-pill"
      style={{ width: 28, height: 28, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}
    >
      <Text style={{ fontSize: 9, color: c.text, fontWeight: '700' }}>{state === 'completed' ? '✓' : letter}</Text>
    </View>
  );
}
