import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import {
  GOAL_SHORT,
  type Goal,
  type GoalTargets,
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
  PixelPencil,
} from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { ThinBar } from '@/ui/fuel/progress-bar';

/**
 * FUEL_REDESIGN — the daily nutrition summary: the page's one number
 * (remaining kcal, loud) beside the three macro rows. Two columns on
 * regular phones, stacked under 400px so nothing crams. The meter colour
 * rules are unchanged — the colour must not lie about the goal.
 *
 * FUEL v2 (NUTRITION_PLAN_2, 2026-07-21): this card is now the whole
 * command centre — the CUT/MAINTAIN/BULK switcher (each inactive chip
 * quotes its stored kcal; switching is a plain target upsert, zero AI)
 * and the ✦ RECALCULATE / EDIT actions that used to live in the deleted
 * bottom ESTIMATED DAILY TARGET card. Protein renders with EMPHASIS —
 * heavier than carbs/fat by weight and size, same colour.
 */

/** One macro row: pixel icon · name · current/target · thin bar.
 *  `emphasis` (protein): bigger label/value/bar — weight, not a new colour. */
export function MacroProgressRow({
  icon,
  label,
  current,
  target,
  color,
  emphasis = false,
}: {
  icon: React.ReactNode;
  label: string;
  current: number;
  target: number;
  color: string;
  emphasis?: boolean;
}) {
  return (
    <View className="mb-s2">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {icon}
          <Text
            className={emphasis ? 'text-text' : 'text-text-dim'}
            allowFontScaling={false}
            style={{ fontSize: emphasis ? 10 : 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            {label}
          </Text>
        </View>
        <Text
          allowFontScaling={false}
          style={{ fontSize: emphasis ? 14 : 12, color, ...pixelFont() }}
        >
          {current}
          <Text className="text-text-mute" style={{ fontSize: 10 }}>
            {' '}
            / {target}g
          </Text>
        </Text>
      </View>
      <View className="mt-s1">
        <ThinBar
          pct={target > 0 ? (current / target) * 100 : 0}
          color={color}
          height={emphasis ? 6 : 4}
        />
      </View>
    </View>
  );
}

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

export function NutritionSummaryCard({
  progress,
  targetKcal,
  baseTarget,
  burned = 0,
  state,
  colour,
  goal,
  macros,
  macroTargets,
  streak,
  streakCapped = false,
  sinceDate,
  triple,
  goalBusy = false,
  onSelectGoal,
  onRecalculate,
  onEdit,
}: {
  progress: IntakeProgress;
  /** The effective ceiling shown after the "/" — base target + burned. */
  targetKcal: number;
  /** The daily target before cardio burn (for the "eaten back" line). */
  baseTarget?: number;
  /** Calories burned in cardio today — folded into the budget. */
  burned?: number;
  state: MeterState;
  /** The meter colour, already resolved through the theme. */
  colour: string;
  goal: Goal;
  macros: MacroProgress;
  macroTargets: MacroTargets;
  streak: number;
  /** True when the streak filled its query window — shown as "N+". */
  streakCapped?: boolean;
  /** target.effective_from — the quiet provenance line by the actions. */
  sinceDate: string;
  /** The stored/derived goal triple; null = unknowable (manual target). */
  triple: GoalTargets | null;
  /** Dim the switcher while the goal write is in flight. */
  goalBusy?: boolean;
  onSelectGoal: (g: Goal) => void;
  onRecalculate: () => void;
  onEdit: () => void;
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
      {burned > 0 ? (
        <View className="mt-s1 flex-row items-center" style={{ gap: 5 }}>
          <PixelFlame size={11} color={colors.warn} />
          <Text className="text-2xs text-text-dim" testID="fuel-burned">
            {baseTarget?.toLocaleString() ?? ''} +{burned.toLocaleString()} burned
          </Text>
        </View>
      ) : null}
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
      {streak > 0 ? (
        <View className="mt-s3 flex-row items-center" style={{ gap: 5 }}>
          <PixelFlame size={12} color={colors.legendary} />
          <Text className="text-2xs text-text-dim" testID="fuel-streak">
            Day {streak}
            {streakCapped ? '+' : ''} streak
          </Text>
        </View>
      ) : null}
    </View>
  );

  // THE GOAL SWITCHER: the current goal is the filled chip; the other two
  // quote their STORED kcal when the triple is known. Tapping writes a new
  // effective-dated target — never an AI call. `triple === null` still shows
  // the chips (the goal itself must stay prominent); the page-level handler
  // explains and opens the intake.
  const goalSwitcher = (
    <View className="flex-row" style={{ gap: 8, opacity: goalBusy ? 0.5 : 1 }}>
      {GOALS.map((g) => {
        const active = g === goal;
        return (
          <Pressable
            key={g}
            onPress={() => !goalBusy && !active && onSelectGoal(g)}
            disabled={goalBusy || active}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: goalBusy }}
            testID={`fuel-goal-switch-${g}`}
            className="flex-1 items-center justify-center rounded-md border px-s1"
            style={{
              minHeight: 40,
              borderColor: active ? colors.accent : colors.border,
              backgroundColor: active ? 'rgba(34,211,238,0.12)' : 'rgba(13,21,36,0.6)',
            }}
          >
            <Text
              className={active ? 'text-accent' : 'text-text-dim'}
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
            >
              {GOAL_SHORT[g]}
            </Text>
            <Text
              className={active ? 'text-accent' : 'text-text-mute'}
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 9, marginTop: 2, ...pixelFont(false) }}
            >
              {active
                ? `${targetKcal.toLocaleString()} kcal`
                : triple
                  ? `${triple[g].toLocaleString()} kcal`
                  : '—'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // The target's own controls, moved up from the deleted bottom card — the
  // testIDs are load-bearing for the Playwright tours.
  const targetActions = (
    <View className="flex-row items-center">
      <Pressable
        onPress={onRecalculate}
        accessibilityRole="button"
        testID="fuel-recalculate"
        className="flex-row items-center justify-center px-s2"
        style={{ minHeight: 44, gap: 6 }}
      >
        <Text
          className="text-epic"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
        >
          ✦ RECALCULATE
        </Text>
      </Pressable>
      <View style={{ width: 1, height: 16, backgroundColor: colors['border-soft'] }} />
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        testID="fuel-edit-target"
        className="flex-row items-center justify-center px-s2"
        style={{ minHeight: 44, gap: 6 }}
      >
        <PixelPencil size={11} color={colors.accent} />
        <Text
          className="text-accent"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
        >
          EDIT
        </Text>
      </Pressable>
      <Text
        className="ml-auto text-2xs text-text-mute"
        numberOfLines={1}
        allowFontScaling={false}
      >
        since {sinceDate}
      </Text>
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
        icon={<PixelMuscle size={15} color={colors.accent} />}
        label="PROTEIN"
        current={macros.protein}
        target={macroTargets.protein}
        color={colors.accent}
        emphasis
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
      <View className="mt-s3">{goalSwitcher}</View>
      <View className="mt-s2 border-t border-border-soft pt-s1">{targetActions}</View>
    </GlowCard>
  );
}
