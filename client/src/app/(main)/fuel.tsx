import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import {
  targetInForce,
  useDeleteEntry,
  useLogCalories,
  useNutritionLog,
  useNutritionTargets,
  useSaveTarget,
} from '@/data/nutrition';
import {
  GOAL_LABEL,
  intakeProgress,
  kjToKcal,
  meterState,
  type Goal,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { todayIso as calendarToday } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NutritionIntake } from '@/ui/fuel/nutrition-intake';
import { NumberField } from '@/ui/core/number-field';
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

/** Meter colour per state — the colour must not lie about the goal. */
const METER_COLOUR = {
  under: tokens.colors.accent,
  reached: tokens.colors.success,
  over_cut: tokens.colors.warn,
} as const;

export default function FuelScreen() {
  const todayIso = calendarToday();

  const log = useNutritionLog(todayIso);
  const targets = useNutritionTargets();
  const logCalories = useLogCalories();
  const deleteEntry = useDeleteEntry();

  const target = targetInForce(targets.data ?? [], todayIso);
  const progress = intakeProgress(log.data ?? [], target?.daily_kcal ?? 0);
  const state = target ? meterState(progress.consumed, target.daily_kcal, target.goal) : 'under';
  const colour = METER_COLOUR[state];

  // QUICK LOG state. Unit is sticky per visit, not persisted — the athlete
  // who thinks in kJ flips once per session.
  const [unit, setUnit] = useState<0 | 1>(0); // 0 = KCAL, 1 = KJ
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');

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

  const kcalPreview = unit === 1 ? enteredKcal() : null;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={`FUEL · ${todayIso}`}
        title={target ? GOAL_LABEL[target.goal].toUpperCase() : 'FUEL'}
        right={<CompanionMenuButton anim={state === 'reached' ? 'victory' : 'idle'} height={56} />}
      />

      {/* THE METER — the page's one number. */}
      <GlowCard glow={target && state !== 'under' ? colour : undefined}>
        {target ? (
          <View>
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
            <View className="mt-s2 flex-row justify-between">
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
                {progress.consumed.toLocaleString()} / {target.daily_kcal.toLocaleString()} KCAL
              </Text>
              <Text className="text-2xs font-bold" style={{ color: colour, letterSpacing: 1 }}>
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

      {/* QUICK LOG — either unit, one tap. */}
      <GlowCard>
        <SectionLabel>QUICK LOG</SectionLabel>
        <SegmentedTabs left="KCAL" right="KJ" active={unit} onChange={setUnit} testIDPrefix="fuel-unit" />
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
          <Text className="mt-s1 text-2xs text-text-dim">≈ {kcalPreview.toLocaleString()} kcal</Text>
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
            <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
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
            <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
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

      {/* TODAY — what moved the meter. */}
      {(log.data ?? []).length > 0 ? (
        <GlowCard>
          <SectionLabel>TODAY</SectionLabel>
          {(log.data ?? []).map((e) => (
            <View key={e.id} className="mb-s2 flex-row items-center">
              <View className="flex-1">
                <Text className="text-sm font-bold text-text" numberOfLines={1}>
                  {e.label ?? 'Logged'}
                </Text>
                <Text className="text-2xs text-text-mute">{timeOf(e.timestamp)}</Text>
              </View>
              <Text className="text-sm font-bold text-accent" style={{ fontVariant: ['tabular-nums'] }}>
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
              <Text className="text-2xl font-bold text-text" style={{ fontVariant: ['tabular-nums'] }}>
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
                <Text className="text-2xs font-bold text-epic" style={{ letterSpacing: 1.5 }}>
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
                <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
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
          style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface }}
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
