/**
 * THE FUEL HERO (2026-08-05) — the consistency pass that merges `FuelHeader`
 * and `NutritionSummaryCard` into the ONE dominant hero the Home/Train
 * standard asks for, the same merge the Oracle pass made
 * (ui/oracle/oracle-hero.tsx). They used to be two separate blocks — a
 * masthead, then a "command centre" card beneath it; now the title, the
 * champion, the calories-remaining figure (counting up) and the macros all
 * live in one card, matching how Home answers "who am I" with one crest.
 *
 * Composition, top to bottom, one card:
 *   kicker + FUEL title + champion + Forge Level
 *   ── hairline ──
 *   REMAINING kcal, counting up, + consumed/target + burned line + bar
 *   MACROS — protein (emphasis) / carbs / fat, each a real ThinBar
 *   NUTRITION SCORE — a real 0–100 adherence-to-target read
 *   (domain/nutrition.ts::nutritionScore), null (hidden) until something is
 *   logged — never a fabricated starting grade
 *   the CUT/MAINTAIN/BULK goal switcher + ✦ RECALCULATE / EDIT
 *
 * Every number is real: the meter colour rules, the goal switcher's stored
 * kcal quotes, and the target's own controls are BYTE-FOR-BYTE what
 * NutritionSummaryCard did — this file only changes where they live.
 */

import { router } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import {
  GOAL_SHORT,
  nutritionScore,
  type Goal,
  type GoalTargets,
  type IntakeProgress,
  type MacroProgress,
  type MacroTargets,
  type MeterState,
} from '@/domain/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { useCountUp } from '@/ui/core/count-up';
import {
  PixelBolt,
  PixelDrop,
  PixelFlame,
  PixelMuscle,
  PixelPencil,
} from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { ThinBar } from '@/ui/fuel/progress-bar';

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

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

export function FuelHero({
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
  const shownHeadline = useCountUp(headline, true, 700);
  const score = nutritionScore(progress.consumed, targetKcal, macros, macroTargets);

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
          {Math.round(shownHeadline).toLocaleString()}
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
      <View className="mt-s3 flex-row items-center" style={{ gap: 10 }}>
        {streak > 0 ? (
          <View className="flex-row items-center" style={{ gap: 5 }}>
            <PixelFlame size={12} color={colors.legendary} />
            <Text className="text-2xs text-text-dim" testID="fuel-streak">
              Day {streak}
              {streakCapped ? '+' : ''} streak
            </Text>
          </View>
        ) : null}
        {score !== null ? (
          <View className="flex-row items-center" style={{ gap: 5 }} testID="fuel-nutrition-score">
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.epic }} />
            <Text className="text-2xs text-text-dim">
              <Text style={{ color: colors.epic, fontWeight: '700' }}>{score}</Text> nutrition score
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  // THE GOAL SWITCHER: the current goal is the filled chip; the other two
  // quote their STORED kcal when the triple is known. Tapping writes a new
  // effective-dated target — never an AI call.
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
    <GlowCard glow={state !== 'under' ? colour : undefined} testID="fuel-hero">
      <FuelMasthead anim={state === 'reached' ? 'victory' : 'idle'} />

      {/* 2 — THE COMMAND CENTRE: remaining + macros. */}
      <View className="mt-s4 border-t border-border-soft pt-s4">
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
      </View>
    </GlowCard>
  );
}

/**
 * THE MASTHEAD — kicker, title, champion, Forge Level. Exported so the
 * NO-TARGET-YET fallback in fuel.tsx (a brand-new athlete with nothing to
 * summarise yet) still gets the same title/champion identity the hero
 * carries once a target exists, instead of losing FUEL's header entirely.
 */
export function FuelMasthead({ anim }: { anim: 'idle' | 'victory' }) {
  const colors = useThemeColors();
  const forge = useForgeProgression();
  const level = forgeProgressFromRow(forge.data ?? null).level;
  return (
    <View className="w-full flex-row items-start justify-between">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', ...pixelFont(false) }}
        >
          EAT LIKE YOU TRAIN
        </Text>
        <Text
          className="text-text"
          allowFontScaling={false}
          style={{
            fontSize: 30,
            lineHeight: 36,
            letterSpacing: 0,
            textShadowColor: 'rgba(34, 211, 238, 0.55)',
            textShadowRadius: 18,
            ...pixelFont(),
          }}
        >
          FUEL
        </Text>
      </View>
      <View className="items-center">
        <View
          className="rounded-lg border p-s1"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(13,21,36,0.6)' }}
        >
          <CompanionMenuButton anim={anim} height={44} />
        </View>
        <Pressable
          onPress={() => router.push('/profile' as never)}
          accessibilityRole="button"
          accessibilityLabel="open profile"
          testID="fuel-header-level"
          className="mt-s1 items-center justify-center"
          style={{ minHeight: 24, minWidth: 44 }}
          hitSlop={{ top: 4, bottom: 16, left: 8, right: 8 }}
        >
          <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
            FORGE LV. {level} ›
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
