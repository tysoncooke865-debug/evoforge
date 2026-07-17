import { Text, View, useWindowDimensions } from 'react-native';

import {
  GOAL_LABEL,
  type Goal,
  type IntakeProgress,
  type MacroProgress,
  type MacroTargets,
  type MeterState,
} from '@/domain/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import {
  PixelBolt,
  PixelDrop,
  PixelFlame,
  PixelMuscle,
  PixelTarget,
} from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { ThinBar } from '@/ui/fuel/progress-bar';

/**
 * FUEL_REDESIGN — the daily nutrition summary: the page's one number
 * (remaining kcal, loud) beside the three macro rows. Two columns on
 * regular phones, stacked under 400px so nothing crams. The meter colour
 * rules are unchanged — the colour must not lie about the goal.
 */

/** One macro row: pixel icon · name · current/target · thin bar. */
export function MacroProgressRow({
  icon,
  label,
  current,
  target,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  current: number;
  target: number;
  color: string;
}) {
  return (
    <View className="mb-s2">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {icon}
          <Text
            className="text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            {label}
          </Text>
        </View>
        <Text allowFontScaling={false} style={{ fontSize: 12, color, ...pixelFont() }}>
          {current}
          <Text className="text-text-mute" style={{ fontSize: 10 }}>
            {' '}
            / {target}g
          </Text>
        </Text>
      </View>
      <View className="mt-s1">
        <ThinBar pct={target > 0 ? (current / target) * 100 : 0} color={color} height={4} />
      </View>
    </View>
  );
}

export function NutritionSummaryCard({
  progress,
  targetKcal,
  state,
  colour,
  goal,
  macros,
  macroTargets,
  streak,
  streakCapped = false,
}: {
  progress: IntakeProgress;
  targetKcal: number;
  state: MeterState;
  /** The meter colour, already resolved through the theme. */
  colour: string;
  goal: Goal;
  macros: MacroProgress;
  macroTargets: MacroTargets;
  streak: number;
  /** True when the streak filled its query window — shown as "N+". */
  streakCapped?: boolean;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const wide = width >= 380;
  const headline = state === 'over_cut' ? progress.over : progress.remaining;
  const headlineLabel = state === 'over_cut' ? 'OVER' : state === 'reached' ? 'TARGET REACHED' : 'REMAINING';

  const calories = (
    <View style={{ flex: wide ? 1.1 : undefined }}>
      <View className="flex-row items-baseline" style={{ gap: 8 }}>
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 38,
            lineHeight: 44,
            color: colour,
            textShadowColor: `${colour}8c`,
            textShadowRadius: 16,
            ...pixelFont(),
          }}
          testID="fuel-remaining"
        >
          {headline.toLocaleString()}
        </Text>
        <Text
          className="text-text-dim"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
        >
          {headlineLabel}
        </Text>
      </View>
      <Text
        className="mt-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {progress.consumed.toLocaleString()} / {targetKcal.toLocaleString()} KCAL
      </Text>
      <View className="mt-s2 flex-row items-center" style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ThinBar pct={progress.barPct} color={colour} height={8} />
        </View>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 10, color: colour, ...pixelFont(false) }}
        >
          {Math.round(progress.barPct)}%
        </Text>
      </View>
      <View className="mt-s3 flex-row items-center" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <PixelTarget size={12} color={colors.accent} />
          <Text className="text-2xs text-text-dim">Goal: {GOAL_LABEL[goal]}</Text>
        </View>
        {streak > 0 ? (
          <>
            <View style={{ width: 1, height: 12, backgroundColor: colors['border-soft'] }} />
            <View className="flex-row items-center" style={{ gap: 5 }}>
              <PixelFlame size={12} color={colors.legendary} />
              <Text className="text-2xs text-text-dim" testID="fuel-streak">
                Day {streak}
                {streakCapped ? '+' : ''} streak
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );

  const macroRows = (
    <View style={{ flex: wide ? 1 : undefined }}>
      <Text
        className="mb-s2 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        MACROS
      </Text>
      <MacroProgressRow
        icon={<PixelMuscle size={13} color={colors.accent} />}
        label="PROTEIN"
        current={macros.protein}
        target={macroTargets.protein}
        color={colors.accent}
      />
      <MacroProgressRow
        icon={<PixelBolt size={12} color={colors.epic} />}
        label="CARBS"
        current={macros.carbs}
        target={macroTargets.carbs}
        color={colors.epic}
      />
      <MacroProgressRow
        icon={<PixelDrop size={12} color={colors.warn} />}
        label="FAT"
        current={macros.fat}
        target={macroTargets.fat}
        color={colors.warn}
      />
    </View>
  );

  return (
    <GlowCard glow={state !== 'under' ? colour : undefined}>
      {wide ? (
        <View className="flex-row" style={{ gap: 20 }}>
          {calories}
          <View style={{ width: 1, backgroundColor: colors['border-soft'] }} />
          {macroRows}
        </View>
      ) : (
        <View>
          {calories}
          <View className="my-s3" style={{ height: 1, backgroundColor: colors['border-soft'] }} />
          {macroRows}
        </View>
      )}
    </GlowCard>
  );
}
