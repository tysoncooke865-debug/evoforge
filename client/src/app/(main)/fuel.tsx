import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import {
  scanMeal,
  scanTotals,
  targetInForce,
  useDeleteEntry,
  useLogCalories,
  useLogMeal,
  useNutritionLog,
  useNutritionTargets,
  useSaveTarget,
  type MealItem,
} from '@/data/nutrition';
import { pickPhoto } from '@/data/ai';
import { KeyPad, NumberField } from '@/ui/core/number-field';
import {
  GOAL_LABEL,
  canAddMeal,
  canRemoveMeal,
  effectiveMealCount,
  intakeProgress,
  kjToKcal,
  mealTotals,
  meterState,
  type Goal,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { todayIso as calendarToday } from '@/domain/today';
import { mealCountOf, useFuelStore } from '@/state/fuel-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Field } from '@/ui/core/field';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NutritionIntake } from '@/ui/fuel/nutrition-intake';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * FUEL — the calorie day (nutrition branch).
 *
 * The meter is the page: everything below it exists to move it. Manual
 * entries only for now; the AI intake (target calculation) and the photo
 * path arrive in later commits on this branch, both feeding the SAME quick
 * log — an estimate is a prefill, never a write.
 *
 * kJ is a first-class unit (AU labels print kJ): the quick log takes either,
 * converts through the pure domain fn at save, and a standalone converter
 * row answers "what is 1650 kJ" without logging anything.
 */

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

/** Meter colour per state (a token KEY, resolved through the theme at
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
  const logCalories = useLogCalories();
  const deleteEntry = useDeleteEntry();

  const target = targetInForce(targets.data ?? [], todayIso);
  const progress = intakeProgress(log.data ?? [], target?.daily_kcal ?? 0);
  const state = target ? meterState(progress.consumed, target.daily_kcal, target.goal) : 'under';
  const colour = colors[METER_COLOUR[state]];

  // QUICK LOG state. Unit is sticky per visit, not persisted — the athlete
  // who thinks in kJ flips once per session.
  const [unit, setUnit] = useState<0 | 1>(0); // 0 = KCAL, 1 = KJ
  // MEAL SCAN (2026-07-18): AI identifies + estimates; the athlete corrects
  // grams / removes items; deterministic totals; SAVE stores kcal+macros+items.
  const [scanBusy, setScanBusy] = useState(false);
  const [scanItems, setScanItems] = useState<MealItem[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [gramsFor, setGramsFor] = useState<number | null>(null);
  const saveMeal = useLogMeal();

  const runScan = async () => {
    setScanError(null);
    const uri = await pickPhoto();
    if (!uri) return;
    setScanBusy(true);
    const r = await scanMeal(uri);
    setScanBusy(false);
    if ('error' in r) setScanError(r.error);
    else setScanItems(r.items);
  };
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');

  // MEALS: the day's slots. Stored count is date-guarded; entries force it up.
  const storedMealCount = useFuelStore(mealCountOf);
  const setMealCount = useFuelStore((s) => s.setMealCount);
  const entries = log.data ?? [];
  const mealCount = effectiveMealCount(storedMealCount, entries);
  const slotTotals = mealTotals(entries, mealCount);
  const [openMeal, setOpenMeal] = useState<number | null>(null);
  const [mealAmount, setMealAmount] = useState('');

  // Converter state — self-contained, persists nothing.
  const [convKj, setConvKj] = useState('');
  const [convKcal, setConvKcal] = useState('');

  // Manual target sheet (the no-AI path; also the escape hatch when the AI
  // intake is unreachable).
  const [targetOpen, setTargetOpen] = useState(false);
  // The AI intake — asks only what the profile doesn't already know.
  const [intakeOpen, setIntakeOpen] = useState(false);

  const enteredKcal = (): number | null => {
    const v = pyFloat(amount);
    if (v === null || v <= 0) return null;
    return Math.round(unit === 1 ? kjToKcal(v) : v);
  };

  const logNow = () => {
    const kcal = enteredKcal();
    if (kcal === null || kcal > 6000) {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT A MEAL',
        subtitle: kcal === null ? 'Enter an amount above zero.' : 'Entries cap at 6,000 kcal.',
      });
      return;
    }
    const trimmed = label.trim();
    logCalories.mutate({ date: todayIso, kcal, label: trimmed === '' ? null : trimmed });
    setAmount('');
    setLabel('');
  };

  const fmt1 = (n: number): string => String(Math.round(n * 10) / 10);
  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Log into a meal slot — same validation and toast as the quick log.
  const logMeal = (slot: number) => {
    const v = pyFloat(mealAmount);
    const kcal = v === null || v <= 0 ? null : Math.round(v);
    if (kcal === null || kcal > 6000) {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT A MEAL',
        subtitle: kcal === null ? 'Enter an amount above zero.' : 'Entries cap at 6,000 kcal.',
      });
      return;
    }
    logCalories.mutate({ date: todayIso, kcal, label: null, mealNo: slot });
    setMealAmount('');
  };

  const kcalPreview = unit === 1 ? enteredKcal() : null;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="EAT LIKE YOU TRAIN"
        title="FUEL"
        right={<CompanionMenuButton anim={state === 'reached' ? 'victory' : 'idle'} height={56} />}
      />

      {/* THE METER — the page's one number. */}
      <GlowCard glow={target && state !== 'under' ? colour : undefined}>
        {target ? (
          <View>
            {/* The page's one number, loud — Home stat-tile treatment. */}
            <View className="mb-s2 flex-row items-baseline" style={{ gap: 6 }}>
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 30,
                  lineHeight: 36,
                  color: colour,
                  textShadowColor: `${colour}8c`,
                  textShadowRadius: 16,
                  ...pixelFont(),
                }}
              >
                {progress.consumed.toLocaleString()}
              </Text>
              <Text
                className="text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
              >
                / {target.daily_kcal.toLocaleString()} KCAL
              </Text>
            </View>
            <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
              <View
                style={{
                  width: `${progress.barPct}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: colour,
                  minWidth: progress.consumed > 0 ? 4 : 0,
                  shadowColor: colour,
                  shadowOpacity: 0.5,
                  shadowRadius: 8,
                }}
              />
            </View>
            <View className="mt-s2 items-end">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 9, color: colour, letterSpacing: 1, ...pixelFont(false) }}
              >
                {state === 'over_cut'
                  ? `${progress.over.toLocaleString()} OVER`
                  : state === 'reached'
                    ? '✓ TARGET REACHED'
                    : `${progress.remaining.toLocaleString()} REMAINING`}
              </Text>
            </View>
          </View>
        ) : (
          <View>
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
          </View>
        )}
      </GlowCard>

      {/* MEALS — the day's structure. Slots hold entries; the footer bumps
          the count exactly like Train's ＋/− SET. */}
      <GlowCard>
        <SectionLabel>MEALS</SectionLabel>
        {Array.from({ length: mealCount }, (_, i) => i + 1).map((slot) => {
          const slotEntries = entries.filter((e) => e.meal_no === slot);
          const total = slotTotals[slot - 1] ?? 0;
          const open = openMeal === slot;
          return (
            <View key={slot} className={slot < mealCount ? 'border-b border-border-soft' : undefined}>
              <Pressable
                onPress={() => {
                  setOpenMeal(open ? null : slot);
                  setMealAmount('');
                }}
                accessibilityRole="button"
                accessibilityLabel={`Meal ${slot}: ${total} kilocalories. ${open ? 'Collapse' : 'Expand'}.`}
                testID={`fuel-meal-${slot}`}
                className="flex-row items-center justify-between"
                style={{ minHeight: 44 }}
              >
                <Text
                  className="text-text-mute"
                  allowFontScaling={false}
                  style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
                >
                  {open ? '▾ ' : '▸ '}MEAL {slot}
                </Text>
                <Text
                  className={total > 0 ? 'text-text' : 'text-text-mute'}
                  allowFontScaling={false}
                  style={{ fontSize: 16, ...pixelFont() }}
                >
                  {total > 0 ? `${total.toLocaleString()} KCAL` : '—'}
                </Text>
              </Pressable>
              {open ? (
                <View className="pb-s2">
                  {slotEntries.map((e) => (
                    <View key={e.id} className="flex-row items-center">
                      <View className="flex-1">
                        <Text className="text-2xs text-text-mute">{timeOf(e.timestamp)}</Text>
                      </View>
                      <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
                        {Math.round(Number(e.kcal)).toLocaleString()} kcal
                      </Text>
                      <Pressable
                        onPress={() => deleteEntry.mutate({ id: e.id, date: e.date })}
                        disabled={e.id.startsWith('temp-')}
                        accessibilityRole="button"
                        accessibilityLabel="delete meal entry"
                        className="ml-s2 items-center justify-center"
                        style={{ minWidth: 44, minHeight: 44, opacity: e.id.startsWith('temp-') ? 0.3 : 1 }}
                        testID={`fuel-meal-delete-${e.id}`}
                      >
                        <Text className="text-sm text-text-mute">✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  <View className="flex-row items-end gap-s2">
                    <View className="flex-1">
                      <Field
                        label="KCAL"
                        value={mealAmount}
                        onChange={setMealAmount}
                        integer
                        testID={`fuel-meal-${slot}-kcal`}
                      />
                    </View>
                    <Pressable
                      onPress={() => logMeal(slot)}
                      accessibilityRole="button"
                      accessibilityLabel={`log to meal ${slot}`}
                      className="items-center justify-center rounded-md border px-s3"
                      style={{ minHeight: 44, borderColor: `${colors.accent}59` }}
                      testID={`fuel-meal-${slot}-log`}
                    >
                      <Text
                        className="text-accent"
                        allowFontScaling={false}
                        style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                      >
                        LOG
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        {/* One VISIBLE tap per action — the exercise-logger footer, verbatim
            rules: − MEAL is absent, not disabled, at the floor. */}
        <View className="mt-s2 flex-row items-center border-t border-border-soft pt-s1">
          {canAddMeal(mealCount) ? (
            <Pressable
              onPress={() => setMealCount(mealCount + 1)}
              accessibilityRole="button"
              accessibilityLabel="add a meal"
              className="items-center justify-center px-s2"
              style={{ minHeight: 44 }}
              testID="fuel-meal-add"
            >
              <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
                ＋ MEAL
              </Text>
            </Pressable>
          ) : null}
          {canRemoveMeal(mealCount, entries) ? (
            <Pressable
              onPress={() => {
                setMealCount(mealCount - 1);
                if (openMeal === mealCount) setOpenMeal(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="remove a meal"
              className="items-center justify-center px-s2"
              style={{ minHeight: 44 }}
              testID="fuel-meal-remove"
            >
              <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
                − MEAL
              </Text>
            </Pressable>
          ) : null}
        </View>
      </GlowCard>

      {/* MEAL SCAN — photo → identified foods → corrections → deterministic
          totals → saved with macros. */}
      <GlowCard>
        <SectionLabel>SCAN A MEAL</SectionLabel>
        {scanItems === null ? (
          <>
            <Text className="mb-s3 text-2xs text-text-mute">
              Photograph your plate — the AI identifies the foods and estimates portions, the numbers
              come from a fixed nutrition table, and you correct anything before it saves.
            </Text>
            <NeonButton
              title={scanBusy ? 'READING THE PLATE…' : '📸 SCAN A MEAL'}
              onPress={() => void runScan()}
              busy={scanBusy}
              pixel
              testID="meal-scan"
            />
            {scanError ? <Text className="mt-s2 text-2xs text-danger">{scanError}</Text> : null}
          </>
        ) : (
          <>
            {scanItems.map((it, i) => {
              const kcal = Math.round((it.grams * it.per100.kcal) / 100);
              return (
                <View key={`${it.name}:${i}`} className="mb-s2 flex-row items-center gap-s2">
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-text" numberOfLines={1}>
                      {it.name}
                      {it.source === 'ai' ? (
                        <Text className="text-2xs text-warn">  AI EST.</Text>
                      ) : null}
                    </Text>
                    <Text className="text-2xs text-text-mute">
                      {kcal} kcal · P{Math.round((it.grams * it.per100.p) / 100)} C{Math.round((it.grams * it.per100.c) / 100)} F{Math.round((it.grams * it.per100.f) / 100)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setGramsFor(i)}
                    accessibilityRole="button"
                    accessibilityLabel={`edit grams for ${it.name}`}
                    className="rounded-md border border-border px-s2 py-s2"
                    style={{ minWidth: 76, alignItems: 'center' }}
                    testID={`meal-grams-${i}`}
                  >
                    <Text className="text-sm font-bold text-text">{it.grams} g</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setScanItems(scanItems.filter((_, j) => j !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`remove ${it.name}`}
                    className="items-center justify-center"
                    style={{ minWidth: 36, minHeight: 44 }}
                    testID={`meal-remove-${i}`}
                  >
                    <Text className="text-sm text-text-mute">✕</Text>
                  </Pressable>
                </View>
              );
            })}
            {(() => {
              const t = scanTotals(scanItems);
              return (
                <View className="mb-s3 flex-row items-center justify-between rounded-lg border px-s3 py-s2" style={{ borderColor: 'rgba(34,211,238,0.35)', backgroundColor: 'rgba(34,211,238,0.06)' }}>
                  <Text className="text-sm font-bold text-accent" testID="meal-total">{t.kcal} kcal</Text>
                  <Text className="text-2xs text-text-dim">P {Math.round(t.p)}g · C {Math.round(t.c)}g · F {Math.round(t.f)}g</Text>
                </View>
              );
            })()}
            <NeonButton
              title="SAVE MEAL"
              onPress={() =>
                saveMeal.mutate(
                  { date: todayIso, items: scanItems },
                  { onSuccess: () => setScanItems(null) }
                )
              }
              busy={saveMeal.isPending}
              disabled={scanItems.length === 0}
              pixel
              testID="meal-save"
            />
            <View className="mt-s2">
              <NeonButton title="DISCARD" variant="ghost" onPress={() => setScanItems(null)} testID="meal-discard" />
            </View>
          </>
        )}
        {gramsFor !== null && scanItems ? (
          <KeyPad
            label={`${scanItems[gramsFor]?.name?.toUpperCase().slice(0, 18) ?? 'PORTION'} · GRAMS`}
            initial={String(scanItems[gramsFor]?.grams ?? '')}
            integer
            tint={colors.accent}
            onDone={(v) => {
              const n = Math.max(1, Math.min(2000, Math.trunc(pyFloat(v) ?? 0)));
              if (n > 0) setScanItems(scanItems.map((it, j) => (j === gramsFor ? { ...it, grams: n } : it)));
            }}
            onClose={() => setGramsFor(null)}
          />
        ) : null}
      </GlowCard>

      {/* QUICK LOG — either unit, one tap. */}
      <GlowCard>
        <SectionLabel>QUICK LOG</SectionLabel>
        <SegmentedTabs left="KCAL" right="KJ" active={unit} onChange={setUnit} testIDPrefix="fuel-unit" pixelLabels />
        <View className="mt-s3 flex-row items-center gap-s2">
          <NumberField
            value={amount}
            onChange={setAmount}
            step={unit === 1 ? 50 : 10}
            bigStep={unit === 1 ? 500 : 100}
            placeholder={unit === 1 ? 'kJ' : 'kcal'}
            label={unit === 1 ? 'ENERGY · KJ' : 'ENERGY · KCAL'}
            width={96}
            testID="fuel-amount"
          />
          <TextInput
            className="min-h-[58px] flex-1 rounded-md border border-border bg-surface-2 px-s3 text-base text-text"
            placeholder="Label (optional)"
            placeholderTextColor="#64758f"
            value={label}
            onChangeText={setLabel}
            maxLength={60}
            testID="fuel-label"
          />
        </View>
        {kcalPreview !== null ? (
          <Text
            className="mt-s1 text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            ≈ {kcalPreview.toLocaleString()} KCAL
          </Text>
        ) : null}
        <View className="mt-s3">
          <NeonButton title="LOG IT" onPress={logNow} busy={logCalories.isPending} testID="fuel-log" />
        </View>
      </GlowCard>

      {/* THE CONVERTER — type either side, the other answers. */}
      <GlowCard>
        <SectionLabel>KJ ⇄ KCAL</SectionLabel>
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
      {entries.filter((e) => e.meal_no === null).length > 0 ? (
        <GlowCard>
          <SectionLabel>TODAY · QUICK ADDS</SectionLabel>
          {entries.filter((e) => e.meal_no === null).map((e) => (
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

      {/* THE TARGET — where the budget comes from. */}
      {target ? (
        <GlowCard>
          <SectionLabel>DAILY TARGET</SectionLabel>
          <View className="flex-row items-center justify-between">
            <View>
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{
                  fontSize: 30,
                  lineHeight: 36,
                  textShadowColor: 'rgba(34,211,238,0.35)',
                  textShadowRadius: 12,
                  ...pixelFont(),
                }}
              >
                {target.daily_kcal.toLocaleString()} kcal
              </Text>
              <Text className="text-2xs text-text-mute">
                {GOAL_LABEL[target.goal]} · since {target.effective_from}
              </Text>
            </View>
            <View>
              <Pressable
                onPress={() => setIntakeOpen(true)}
                accessibilityRole="button"
                testID="fuel-recalculate"
                className="items-center justify-center px-s3"
                style={{ minHeight: 44 }}
              >
                <Text
                  className="text-epic"
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
                >
                  ✦ RECALCULATE
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTargetOpen(true)}
                accessibilityRole="button"
                testID="fuel-edit-target"
                className="items-center justify-center px-s3"
                style={{ minHeight: 44 }}
              >
                <Text
                  className="text-accent"
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
                >
                  EDIT
                </Text>
              </Pressable>
            </View>
          </View>
        </GlowCard>
      ) : null}

      {intakeOpen ? (
        <NutritionIntake onClose={() => setIntakeOpen(false)} onManual={() => setTargetOpen(true)} />
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
 * intake (later commit) SAVES THROUGH THE SAME MUTATION; this sheet is why a
 * network-less athlete can still have a budget.
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
    // Mirrors 020's check constraint — reject here so the toast can explain.
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
