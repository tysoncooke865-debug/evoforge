/**
 * PAGE LAB — COUNTERWEIGHT (fuel batch 1, 2026-09-24): the calorie-needs
 * box rework, forked from variants/fuel/baseline.tsx. The batch's thesis,
 * on top of the baseline's four fork divergences:
 *   1. RECALCULATE WORKS AGAIN. The live button opens the AI intake, which
 *      short-circuits to a read-only review (the diagnosed regression). Here
 *      it opens ./counterweight/recalculate-sheet — a LOCAL, fully editable
 *      calculator (age, sex, height, weight, activity, goal, rate); zero AI
 *      on the whole path, so the baseline's intake guard has nothing left
 *      to guard.
 *   2. THE GOAL SWITCHER IS GONE. The hero fork
 *      (./counterweight/fuel-hero) shows two display boxes — goal left,
 *      MAINTAIN right — and goal changes happen inside RECALCULATE.
 *   3. EDIT → SET MANUALLY: the manual sheet is ONE kcal input; the goal
 *      chips are removed and the in-force goal carries forward
 *      (./counterweight/model's manualSavePayload).
 *   4. The triple resolves through the DUAL-RATE model (columns win, else
 *      asymmetric derivation) instead of the symmetric goalTargetsFromInputs.
 * Writes still go ONLY through the lab save-target/delete-entry shims.
 */
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import {
  targetInForce,
  useCaloriesBurned,
  useNutritionDates,
  useNutritionLog,
  useNutritionTargets,
  type NutritionTargetRow,
} from '@/data/nutrition';
import {
  useLabDeleteEntry as useDeleteEntry,
  useLabSaveTarget as useSaveTarget,
} from '@/lab/mock/mutations';
import { NumberField } from '@/ui/core/number-field';
import {
  evalEnergyExpression,
  intakeProgress,
  kjToKcal,
  macroProgress,
  macroTargetsFor,
  meterState,
  streakDays,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { todayIso as calendarToday } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { AIMealScanCard } from '@/ui/fuel/meal-scan-card';
import { MealsSection } from '@/ui/fuel/meals-section';
import { QuickLogCard } from '@/ui/fuel/quick-log-card';
import { SavedMealsCard } from '@/ui/fuel/saved-meals-card';

import { FuelHero, FuelMasthead } from './counterweight/fuel-hero';
import { dualTripleFromStored, manualSavePayload } from './counterweight/model';
import { RecalculateSheet } from './counterweight/recalculate-sheet';

/** Meter colour per state (token KEYS, resolved through the theme at
 *  render) — the colour must not lie about the goal. */
const METER_COLOUR = {
  under: 'accent',
  reached: 'success',
  over_cut: 'warn',
} as const;

export function FuelCounterweight() {
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

  // The target modals — the recalculate sheet asks (locally), the manual
  // sheet is the escape hatch; both save through the same shimmed mutation.
  const [targetOpen, setTargetOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  /** The first-run explainer, collapsed by default (brief §9: "move longer
   *  explanations into Learn more"). */
  const [learnMore, setLearnMore] = useState(false);

  // THE TRIPLE, dual-rate resolved (fork divergence #4): stored columns
  // first (081's contract), else derive asymmetrically. Manual targets ({}
  // inputs) resolve to null — the maintain box says RECALCULATE TO FILL.
  const resolvedTriple = dualTripleFromStored(target);

  // The goal box's rate caption, read from the stored inputs — never
  // invented (manual rows and pre-dual gain rows have no honest rate).
  const storedNum = (k: string): number =>
    Number((target?.inputs as Record<string, unknown> | null | undefined)?.[k]);
  const rateLine =
    !target || target.goal === 'maintain'
      ? null
      : target.goal === 'lose'
        ? Number.isFinite(storedNum('ratePerWeekKg')) && storedNum('ratePerWeekKg') > 0
          ? `−${storedNum('ratePerWeekKg')} KG/WK`
          : null
        : Number.isFinite(storedNum('rateGainKgPerWeek')) && storedNum('rateGainKgPerWeek') > 0
          ? `+${storedNum('rateGainKgPerWeek')} KG/WK`
          : null;

  // Converter state — self-contained, persists nothing. Collapsed by
  // default (2026-08-05): real, but low-retention next to the hero's own
  // nutrition score, so it no longer claims a prominent card of its own.
  const [convKj, setConvKj] = useState('');
  const [convKcal, setConvKcal] = useState('');
  const [convOpen, setConvOpen] = useState(false);
  const fmt1 = (n: number): string => String(Math.round(n * 10) / 10);

  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const quickAdds = entries.filter((e) => e.meal_no === null);

  return (
    <ScreenShell>
      {/* THE HERO — title, champion, the counting-up calories figure, macros,
          the goal + maintain boxes and the target's own controls, all one
          card. */}
      {target ? (
        <FuelHero
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
          sinceDate={target.effective_from}
          triple={resolvedTriple}
          rateLine={rateLine}
          onRecalculate={() => setRecalcOpen(true)}
          onSetManually={() => setTargetOpen(true)}
        />
      ) : (
        <GlowCard>
          <FuelMasthead anim="idle" />
          <View className="mt-s4 border-t border-border-soft pt-s4">
            {/* TWO CLEAR OPTIONS, and one sentence on the difference between
                them (Tyson, 2026-08-06) — reworded now that the calculator
                is local maths, not an AI conversation. */}
            <SectionLabel>NO TARGET YET</SectionLabel>
            <Text className="mb-s3 text-sm text-text-dim">
              Set a daily calorie budget and the meter fills as you log.
            </Text>
            <NeonButton
              title="CALCULATE MY TARGET"
              onPress={() => setRecalcOpen(true)}
              testID="fuel-calc-target"
            />
            <View className="mt-s2">
              <NeonButton
                title="SET MY OWN TARGET"
                variant="ghost"
                onPress={() => setTargetOpen(true)}
                testID="fuel-set-target"
              />
            </View>
            <Text className="mt-s3 text-2xs text-text-dim" testID="fuel-target-choice-help">
              The calculator estimates from your stats — the maths runs on your device. Manual
              setup gives you complete control.
            </Text>
            <Pressable
              onPress={() => setLearnMore((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: learnMore }}
              accessibilityLabel={learnMore ? 'Hide details about calorie targets' : 'Learn more about calorie targets'}
              testID="fuel-learn-more"
              className="mt-s2"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text className="text-2xs" style={{ color: colors.accent, letterSpacing: 0.5 }}>
                {learnMore ? 'LESS ›' : 'LEARN MORE ›'}
              </Text>
            </Pressable>
            {learnMore ? (
              <Text className="mt-s1 text-2xs text-text-mute" testID="fuel-learn-more-body">
                A calculated target uses your height, weight, age and training load to estimate the
                calories you burn in a day, then adjusts for your goal. It is an estimate: bodies
                differ, and the honest test is what happens to your weight over two or three weeks.
                You can change the number or switch to your own at any time, and every change takes
                effect from today onward — nothing already logged is rewritten. EvoForge is not a
                medical service; talk to a doctor or dietitian before making big changes.
              </Text>
            ) : null}
          </View>
        </GlowCard>
      )}

      {/* THE SCANNERS — photo AI and barcode, one confirm sheet. */}
      <AIMealScanCard date={todayIso} />

      {/* SAVED MEALS (081) — one tap re-logs a meal saved from the sheet. */}
      <SavedMealsCard date={todayIso} />

      {/* QUICK LOG — either unit, one confirm. */}
      <QuickLogCard date={todayIso} />

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

      {/* TODAY'S MEALS — the day's record, reading LAST (FUEL v2): the page
          opens on what to do next; what you already did closes it out. */}
      <MealsSection entries={entries} consumed={progress.consumed} />

      {/* THE UNIT CONVERTER (2026-08-05): real, but low-retention next to
          the hero's own nutrition score — collapsed by default rather than
          claiming a prominent card. Either side takes label ARITHMETIC
          ("435×5", "1650/4+300"): the expression evaluates and the other
          side converts the total — no separate calculator app for a
          5-serving box. */}
      <GlowCard>
        <Pressable
          onPress={() => setConvOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`${convOpen ? 'collapse' : 'expand'} the kilojoule to kilocalorie converter`}
          testID="fuel-converter-toggle"
          className="flex-row items-center justify-between"
          style={{ minHeight: 32 }}
        >
          <SectionLabel size="lg">UNIT CONVERTER</SectionLabel>
          <Text className="text-sm text-text-mute">{convOpen ? '▾' : '▸'}</Text>
        </Pressable>
        {convOpen ? (
          <View className="mt-s3 flex-row items-center gap-s2">
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
                  const n = evalEnergyExpression(v);
                  setConvKcal(n === null ? '' : fmt1(kjToKcal(n)));
                }}
                step={100}
                placeholder="kJ"
                label="KILOJOULES"
                width={96}
                calculator
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
                  const n = evalEnergyExpression(v);
                  setConvKj(n === null ? '' : fmt1(n * 4.184));
                }}
                step={50}
                placeholder="kcal"
                label="KILOCALORIES"
                width={96}
                calculator
                testID="fuel-conv-kcal"
              />
            </View>
          </View>
        ) : null}
      </GlowCard>

      <RecalculateSheet
        open={recalcOpen}
        stored={target?.inputs ?? null}
        currentGoal={target?.goal ?? 'maintain'}
        todayIso={todayIso}
        onClose={() => setRecalcOpen(false)}
      />

      {targetOpen ? (
        <ManualTargetSheet target={target} todayIso={todayIso} onClose={() => setTargetOpen(false)} />
      ) : null}
    </ScreenShell>
  );
}

/**
 * SET MANUALLY — one number, no questions (fork divergence #3). The goal
 * chips are gone: a manual number changes the budget, not the plan, so the
 * in-force goal carries forward (maintain when none exists yet). The
 * payload — triple cleared, weightKg carried for the protein target — is
 * built and pinned in ./counterweight/model.
 */
function ManualTargetSheet({
  target,
  todayIso,
  onClose,
}: {
  target: NutritionTargetRow | null;
  todayIso: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [kcal, setKcal] = useState(target === null ? '' : String(target.daily_kcal));
  const saveTarget = useSaveTarget();

  const save = () => {
    const payload = manualSavePayload(
      pyFloat(kcal),
      target?.goal ?? null,
      target?.inputs ?? null,
      todayIso
    );
    // Mirrors 037's check constraint — reject here so the toast can explain.
    if (payload === null) {
      useToastStore.getState().push({
        kind: 'error',
        title: 'PICK A REAL TARGET',
        subtitle: 'Daily targets run 1,000–6,000 kcal.',
      });
      return;
    }
    saveTarget.mutate(payload, { onSuccess: onClose });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface }}
        >
          <SectionLabel>SET MY OWN TARGET</SectionLabel>
          <Text className="mb-s2 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            DAILY CALORIES
          </Text>
          <View className="items-center">
            <NumberField
              value={kcal}
              onChange={setKcal}
              step={50}
              bigStep={500}
              placeholder="kcal"
              label="TARGET · KCAL PER DAY"
              width={120}
              testID="fuel-target-kcal"
            />
          </View>
          <Text className="mt-s1 text-center text-2xs text-text-mute">
            Calories (kcal) per day. Daily targets run 1,000–6,000. Your goal stays as it is —
            change it with ✦ RECALCULATE.
          </Text>
          <View className="mt-s3">
            {/* The button says what it will save, so nobody has to guess what
                the number was when the sheet closes. */}
            <NeonButton
              title={
                pyFloat(kcal) !== null
                  ? `SET TARGET · ${Math.round(pyFloat(kcal) as number).toLocaleString()} KCAL`
                  : 'SET TARGET'
              }
              onPress={save}
              busy={saveTarget.isPending}
              testID="fuel-target-save"
            />
          </View>
          <View className="mt-s2">
            <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="fuel-target-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
