import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import {
  targetInForce,
  useCaloriesBurned,
  useDeleteEntry,
  useNutritionDates,
  useNutritionLog,
  useNutritionTargets,
  useSaveTarget,
} from '@/data/nutrition';
import { NumberField } from '@/ui/core/number-field';
import {
  GOAL_LABEL,
  intakeProgress,
  kjToKcal,
  macroProgress,
  macroTargetsFor,
  meterState,
  streakDays,
  type Goal,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { todayIso as calendarToday } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NutritionIntake } from '@/ui/fuel/nutrition-intake';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { DailyTargetCard } from '@/ui/fuel/daily-target-card';
import { FuelBonusCard } from '@/ui/fuel/fuel-bonus-card';
import { FuelHeader } from '@/ui/fuel/fuel-header';
import { AIMealScanCard } from '@/ui/fuel/meal-scan-card';
import { MealsSection } from '@/ui/fuel/meals-section';
import { NutritionSummaryCard } from '@/ui/fuel/nutrition-summary-card';
import { QuickLogCard } from '@/ui/fuel/quick-log-card';

/**
 * FUEL — the calorie day (FUEL_REDESIGN, 2026-07-18: Tyson's reference
 * layout). The page is now a composition; each card owns its own state and
 * mutations, this file owns the day's derived numbers and the two target
 * modals. Everything still moves the same meter: one query, one rulebook.
 *
 * Order (the reference, top to bottom): header · summary (remaining +
 * macros) · AI meal scan + barcode · today's meals · fuel bonus · quick
 * log · daily target · converter · quick-adds.
 */

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

/** Meter colour per state (token KEYS, resolved through the theme at
 *  render) — the colour must not lie about the goal. */
const METER_COLOUR = {
  under: 'accent',
  reached: 'success',
  over_cut: 'warn',
} as const;

export default function FuelScreen() {
  const colors = useThemeColors();
  const todayIso = calendarToday();

  const log = useNutritionLog(todayIso);
  const targets = useNutritionTargets();
  const dates = useNutritionDates(todayIso);
  const deleteEntry = useDeleteEntry();

  const entries = log.data ?? [];
  const target = targetInForce(targets.data ?? [], todayIso);
  // Calories burned in cardio raise the day's ceiling — you can eat them back.
  const burned = useCaloriesBurned(todayIso).data ?? 0;
  const effectiveTarget = target ? target.daily_kcal + burned : 0;
  const progress = intakeProgress(entries, effectiveTarget);
  const state = target ? meterState(progress.consumed, effectiveTarget, target.goal) : 'under';
  const colour = colors[METER_COLOUR[state]];
  const macros = macroProgress(entries);
  const macroTargets = macroTargetsFor(target);
  const streak = streakDays(dates.data ?? [], todayIso);
  // The dates query looks back 45 days; a run that fills the whole window
  // reads "Day 45+ streak" — a visible ceiling, never a silently stuck one.
  const streakCapped = streak > 45;

  // The target modals — the AI intake asks, the manual sheet is the escape
  // hatch; both save through the same mutation.
  const [targetOpen, setTargetOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);

  // Converter state — self-contained, persists nothing.
  const [convKj, setConvKj] = useState('');
  const [convKcal, setConvKcal] = useState('');
  const fmt1 = (n: number): string => String(Math.round(n * 10) / 10);

  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const quickAdds = entries.filter((e) => e.meal_no === null);

  return (
    <ScreenShell>
      <FuelHeader anim={state === 'reached' ? 'victory' : 'idle'} />

      {/* THE SUMMARY — the page's one number beside the three macros. */}
      {target ? (
        <NutritionSummaryCard
          progress={progress}
          targetKcal={effectiveTarget}
          baseTarget={target.daily_kcal}
          burned={burned}
          state={state}
          colour={colour}
          goal={target.goal}
          macros={macros}
          macroTargets={macroTargets}
          streak={streakCapped ? 45 : streak}
          streakCapped={streakCapped}
        />
      ) : (
        <GlowCard>
          <SectionLabel>NO TARGET YET</SectionLabel>
          <Text className="mb-s3 text-sm text-text-dim">
            Set a daily calorie budget and the meter fills as you log.
          </Text>
          <NeonButton
            title="✦ CALCULATE WITH AI"
            onPress={() => setIntakeOpen(true)}
            testID="fuel-ai-target"
          />
          <View className="mt-s2">
            <NeonButton
              title="SET MANUALLY"
              variant="ghost"
              onPress={() => setTargetOpen(true)}
              testID="fuel-set-target"
            />
          </View>
        </GlowCard>
      )}

      {/* THE SCANNERS — photo AI and barcode, one confirm sheet. */}
      <AIMealScanCard date={todayIso} />

      {/* THE DAY'S STRUCTURE — named slots (display-only since 2026-07-19). */}
      <MealsSection entries={entries} consumed={progress.consumed} />

      {/* THE PROTEIN GOAL — a reward card that promises nothing unbacked. */}
      <FuelBonusCard
        proteinTarget={macroTargets.protein}
        proteinConsumed={macros.protein}
        dinnerLogged={entries.some((e) => e.meal_no === 3)}
      />

      {/* QUICK LOG — either unit, one confirm. */}
      <QuickLogCard date={todayIso} />

      {/* THE TARGET — where the budget comes from. */}
      {target ? (
        <DailyTargetCard
          target={target}
          onRecalculate={() => setIntakeOpen(true)}
          onEdit={() => setTargetOpen(true)}
        />
      ) : null}

      {/* THE CONVERTER — type either side, the other answers. */}
      <GlowCard>
        <SectionLabel size="lg">KJ ⇄ KCAL CONVERTER</SectionLabel>
        <View className="flex-row items-center gap-s2">
          <View className="flex-1 items-center">
            <Text
              className="mb-s1 text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
            >
              KILOJOULES
            </Text>
            <NumberField
              value={convKj}
              onChange={(v) => {
                setConvKj(v);
                const n = pyFloat(v);
                setConvKcal(n === null ? '' : fmt1(kjToKcal(n)));
              }}
              step={100}
              placeholder="kJ"
              label="KILOJOULES"
              width={96}
              testID="fuel-conv-kj"
            />
          </View>
          <Text className="text-lg font-bold text-text-mute">⇄</Text>
          <View className="flex-1 items-center">
            <Text
              className="mb-s1 text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
            >
              KILOCALORIES
            </Text>
            <NumberField
              value={convKcal}
              onChange={(v) => {
                setConvKcal(v);
                const n = pyFloat(v);
                setConvKj(n === null ? '' : fmt1(n * 4.184));
              }}
              step={50}
              placeholder="kcal"
              label="KILOCALORIES"
              width={96}
              testID="fuel-conv-kcal"
            />
          </View>
        </View>
      </GlowCard>

      {/* TODAY — the quick-adds. Meal entries live (and delete) inside their
          slots above; listing them twice would be noise. The meter sums all. */}
      {quickAdds.length > 0 ? (
        <GlowCard>
          <SectionLabel>TODAY · QUICK ADDS</SectionLabel>
          {quickAdds.map((e) => (
            <View key={e.id} className="mb-s2 flex-row items-center">
              <View className="flex-1">
                <Text className="text-sm font-bold text-text" numberOfLines={1}>
                  {e.label ?? 'Logged'}
                </Text>
                <Text className="text-2xs text-text-mute">{timeOf(e.timestamp)}</Text>
              </View>
              <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 16, ...pixelFont() }}>
                {Math.round(Number(e.kcal)).toLocaleString()} kcal
              </Text>
              <Pressable
                onPress={() => deleteEntry.mutate({ id: e.id, date: e.date })}
                disabled={e.id.startsWith('temp-')}
                accessibilityRole="button"
                accessibilityLabel={`delete ${e.label ?? 'entry'}`}
                className="ml-s2 items-center justify-center"
                style={{ minWidth: 44, minHeight: 44, opacity: e.id.startsWith('temp-') ? 0.3 : 1 }}
                testID={`fuel-delete-${e.id}`}
              >
                <Text className="text-sm text-text-mute">✕</Text>
              </Pressable>
            </View>
          ))}
        </GlowCard>
      ) : null}

      {intakeOpen ? (
        <NutritionIntake
          onClose={() => setIntakeOpen(false)}
          onManual={() => setTargetOpen(true)}
          previous={target?.inputs ?? null}
        />
      ) : null}

      {targetOpen ? (
        <ManualTargetSheet
          initialKcal={target?.daily_kcal ?? null}
          initialGoal={target?.goal ?? 'maintain'}
          todayIso={todayIso}
          onClose={() => setTargetOpen(false)}
        />
      ) : null}
    </ScreenShell>
  );
}

/**
 * The manual target sheet — the no-AI path, and the escape hatch. The AI
 * intake SAVES THROUGH THE SAME MUTATION; this sheet is why a network-less
 * athlete can still have a budget.
 */
function ManualTargetSheet({
  initialKcal,
  initialGoal,
  todayIso,
  onClose,
}: {
  initialKcal: number | null;
  initialGoal: Goal;
  todayIso: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [kcal, setKcal] = useState(initialKcal === null ? '' : String(initialKcal));
  const [goal, setGoal] = useState<Goal>(initialGoal);
  const saveTarget = useSaveTarget();

  const save = () => {
    const v = pyFloat(kcal);
    // Mirrors 037's check constraint — reject here so the toast can explain.
    if (v === null || v < 1000 || v > 6000) {
      useToastStore.getState().push({
        kind: 'error',
        title: 'PICK A REAL TARGET',
        subtitle: 'Daily targets run 1,000–6,000 kcal.',
      });
      return;
    }
    saveTarget.mutate(
      { effectiveFrom: todayIso, dailyKcal: Math.round(v), goal, inputs: {} },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface }}
        >
          <SectionLabel>DAILY TARGET · MANUAL</SectionLabel>
          <View className="mb-s3 flex-row flex-wrap gap-s2">
            {GOALS.map((g) => (
              <Chip key={g} label={GOAL_LABEL[g]} active={g === goal} onPress={() => setGoal(g)} testID={`fuel-goal-${g}`} />
            ))}
          </View>
          <View className="items-center">
            <NumberField
              value={kcal}
              onChange={setKcal}
              step={50}
              bigStep={500}
              placeholder="kcal"
              label="TARGET · KCAL"
              width={120}
              testID="fuel-target-kcal"
            />
          </View>
          <View className="mt-s3">
            <NeonButton title="SET TARGET" onPress={save} busy={saveTarget.isPending} testID="fuel-target-save" />
          </View>
          <View className="mt-s2">
            <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="fuel-target-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
