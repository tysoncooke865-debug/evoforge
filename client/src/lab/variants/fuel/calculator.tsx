/**
 * PAGE LAB — CALCULATOR fork of src/app/(main)/fuel.tsx (prototyped
 * 2026-08-21). Three owner-approved product changes over the live screen:
 *   1. ✦ RECALCULATE opens a LOCAL, EDITABLE calculator sheet
 *      (./calculator/recalculate-sheet) — the live button opens the AI
 *      intake, which short-circuits to a read-only review and so
 *      effectively does nothing.
 *   2. Independent CUT and BULK rates (./calculator/model): the goal
 *      switcher keeps its three-box structure but quotes an ASYMMETRIC
 *      triple, with small rate captions under CUT and BULK.
 *   3. The unit converter defaults OPEN.
 * Fork recipe divergences beyond those: named export; the write hooks come
 * from the lab shims (mock-safe); FuelHero and QuickLogCard are the sibling
 * copies under ./calculator/; NutritionIntake is gone entirely. Everything
 * else — structure, comments, the file-local ManualTargetSheet — is the
 * live file.
 */
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import {
  targetInForce,
  useCaloriesBurned,
  useNutritionDates,
  useNutritionLog,
  useNutritionTargets,
} from '@/data/nutrition';
import {
  useLabDeleteEntry as useDeleteEntry,
  useLabSaveTarget as useSaveTarget,
} from '@/lab/mock/mutations';
import { NumberField } from '@/ui/core/number-field';
import {
  GOAL_LABEL,
  evalEnergyExpression,
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
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { AiNotice } from '@/ui/legal/ai-badge';
import { FuelHero, FuelMasthead } from './calculator/fuel-hero';
import { AIMealScanCard } from '@/ui/fuel/meal-scan-card';
import { MealsSection } from '@/ui/fuel/meals-section';
import { QuickLogCard } from './calculator/quick-log-card';
import { dualRateInputsFromStored, dualTripleFromStored } from './calculator/model';
import { RecalculateSheet } from './calculator/recalculate-sheet';
import { SavedMealsCard } from '@/ui/fuel/saved-meals-card';

/**
 * FUEL — the calorie day (FUEL_REDESIGN 2026-07-18; FUEL v2, 2026-07-21;
 * CONSISTENCY PASS 2026-08-05). The page is a composition; each card owns
 * its own state and mutations, this file owns the day's derived numbers,
 * the two target modals, and the goal switch. One query, one rulebook.
 *
 * 2026-08-05: `FuelHeader` and `NutritionSummaryCard` — a masthead and a
 * "command centre" card stacked beneath it — merged into ONE dominant hero
 * (`ui/fuel/fuel-hero.tsx`), the same merge the Oracle pass made
 * (ui/oracle/oracle-hero.tsx): title, champion, the counting-up calories
 * figure, macros and the goal switcher now live in one card. The KJ⇄KCAL
 * CONVERTER — real but low-retention, and the brief calls it out by name —
 * moved out of the main flow into a collapsed UNIT CONVERTER disclosure
 * near the foot of the page; SAVED MEALS (real favourite-meal data, not a
 * new widget) moved up to sit right under the scanner instead.
 *
 * Order (top to bottom): hero · AI meal scan + barcode · saved meals ·
 * quick log · quick-adds · today's meals (the day's record reads last) ·
 * the unit converter, collapsed.
 */

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

/** Meter colour per state (token KEYS, resolved through the theme at
 *  render) — the colour must not lie about the goal. */
const METER_COLOUR = {
  under: 'accent',
  reached: 'success',
  over_cut: 'warn',
} as const;

export function FuelCalculator() {
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

  // The target modals — the LOCAL calculator sheet asks (variant change #1;
  // the AI intake is gone), the manual sheet stays the escape hatch; both
  // save through the same shimmed mutation.
  const [targetOpen, setTargetOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  /** The first-run explainer, collapsed by default (brief §9: "move longer
   *  explanations into Learn more"). */
  const [learnMore, setLearnMore] = useState(false);

  // THE GOAL SWITCH (081): stored columns first, else derive from the saved
  // inputs — ASYMMETRICALLY (variant change #2, ./calculator/model): a
  // pre-dual row's BULK leg gets the 0.25 kg/wk default, never a mirror of
  // the cut rate. Manual targets ({} inputs) still resolve to null —
  // switching then explains and opens the calculator instead of guessing.
  const saveTarget = useSaveTarget();
  const resolvedTriple = dualTripleFromStored(target);
  // The hero's rate captions (variant change #2) — null for manual targets.
  const rates = dualRateInputsFromStored(target?.inputs);
  const switchGoal = (g: Goal) => {
    if (!target || g === target.goal) return;
    if (!resolvedTriple) {
      useToastStore.getState().push({
        kind: 'info',
        title: 'RECALCULATE FIRST',
        subtitle: 'This target predates goal switching — run the calculator once.',
      });
      setRecalcOpen(true);
      return;
    }
    // A plain effective-dated upsert — no AI anywhere on this path. The
    // triple rides along so every future switch stays instant.
    saveTarget.mutate({
      effectiveFrom: todayIso,
      dailyKcal: resolvedTriple[g],
      goal: g,
      inputs: target.inputs,
      triple: resolvedTriple,
    });
  };

  // Converter state — self-contained, persists nothing. OPEN by default
  // (variant change #3): conversions are a MID-LOG task — a kJ label in one
  // hand, the quick log in the other — so the card opens ready instead of
  // charging a tap for the exact situation it exists for.
  const [convKj, setConvKj] = useState('');
  const [convKcal, setConvKcal] = useState('');
  const [convOpen, setConvOpen] = useState(true);
  const fmt1 = (n: number): string => String(Math.round(n * 10) / 10);

  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const quickAdds = entries.filter((e) => e.meal_no === null);

  return (
    <ScreenShell>
      {/* THE HERO — title, champion, the counting-up calories figure, macros,
          the goal switcher and the target's own controls, all one card
          (FUEL v2 / consistency pass). */}
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
          rates={rates ? { loss: rates.rateLossKgPerWeek, gain: rates.rateGainKgPerWeek } : null}
          goalBusy={saveTarget.isPending}
          onSelectGoal={switchGoal}
          onRecalculate={() => setRecalcOpen(true)}
          onEdit={() => setTargetOpen(true)}
        />
      ) : (
        <GlowCard>
          <FuelMasthead anim="idle" />
          <View className="mt-s4 border-t border-border-soft pt-s4">
            {/* TWO CLEAR OPTIONS, and one sentence on the difference between
                them (Tyson, 2026-08-06). It read "SET MANUALLY" under
                "CALCULATE WITH AI" with nothing to say which an athlete
                should pick or what changes if they do. */}
            <SectionLabel>NO TARGET YET</SectionLabel>
            <Text className="mb-s3 text-sm text-text-dim">
              Set a daily calorie budget and the meter fills as you log.
            </Text>
            <NeonButton
              title="CALCULATE MY TARGET"
              onPress={() => setRecalcOpen(true)}
              testID="fuel-ai-target"
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
              AI gives you a starting estimate from your stats. Manual setup gives you complete
              control.
            </Text>
            <View className="mt-s2">
              {/* The health disclaimer stays put; the longer explanation is
                  behind LEARN MORE so it does not bury the choice. */}
              <AiNotice text="AI estimates are a starting point, not medical advice." />
            </View>
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

      {/* THE UNIT CONVERTER — OPEN by default (variant change #3, reversing
          the 2026-08-05 collapse): conversions are a mid-log task, so the
          card opens ready. Either side takes label ARITHMETIC
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

      {/* THE CALCULATOR SHEET (variant change #1) — local and editable,
          in place of the live screen's AI intake. */}
      <RecalculateSheet
        open={recalcOpen}
        stored={target?.inputs ?? null}
        currentGoal={target?.goal ?? 'lose'}
        todayIso={todayIso}
        onClose={() => setRecalcOpen(false)}
      />

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
    // A manual number is the athlete overriding the model: `triple: null`
    // EXPLICITLY clears any stored goal triple, so the switcher can never
    // quote calories the hand-typed target contradicts.
    saveTarget.mutate(
      { effectiveFrom: todayIso, dailyKcal: Math.round(v), goal, inputs: {}, triple: null },
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
          {/* NUMBERED, so the manual flow reads as one connected sequence
              rather than two unlabelled controls (Tyson, 2026-08-06). */}
          <SectionLabel>SET MY OWN TARGET</SectionLabel>
          <Text className="mb-s2 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            1 · YOUR GOAL
          </Text>
          <View className="mb-s3 flex-row flex-wrap gap-s2">
            {GOALS.map((g) => (
              <Chip key={g} label={GOAL_LABEL[g]} active={g === goal} onPress={() => setGoal(g)} testID={`fuel-goal-${g}`} />
            ))}
          </View>
          <Text className="mb-s2 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            2 · DAILY CALORIES
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
            Calories (kcal) per day. Daily targets run 1,000–6,000.
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
