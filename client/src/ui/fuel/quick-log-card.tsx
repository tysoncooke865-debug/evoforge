import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useLogCalories } from '@/data/nutrition';
import { evalEnergyExpression, kjToKcal } from '@/domain/nutrition';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NumberField } from '@/ui/core/number-field';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';
import { MealSlotPicker } from '@/ui/fuel/meal-slot-picker';

/**
 * FUEL_REDESIGN — the quick log: either unit, one confirm. The +N chips ADD
 * to the amount field (in the active unit) rather than saving — LOG IT is
 * the only write, per the redesign spec. Unit stays sticky per visit.
 *
 * THE NUMBER IS THE CARD (2026-07-20): the energy amount is the card's one
 * job, so it sits first and biggest; the label and meal slot are optional
 * detail beneath it. The field takes LABEL ARITHMETIC ("435×5" for a
 * five-serving box — + − × ÷, same evaluator as the converter); entry
 * collapses to the RESULT (keypad DONE / blur), and logging evaluates too,
 * so the number stored — and shown in the day's history — is always the
 * total, never the equation.
 */
const QUICK_ADDS = [100, 200, 300, 500] as const;

export function QuickLogCard({ date }: { date: string }) {
  const logCalories = useLogCalories();
  const [unit, setUnit] = useState<0 | 1>(0); // 0 = KCAL, 1 = KJ
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [mealSlot, setMealSlot] = useState<number | null>(null);

  const enteredKcal = (): number | null => {
    const v = evalEnergyExpression(amount);
    if (v === null || v <= 0) return null;
    // Reject the ROUNDED value: 2 kJ rounds to 0 kcal, and 0 violates the
    // DB's kcal > 0 CHECK — "above zero" must mean the number we store.
    const r = Math.round(unit === 1 ? kjToKcal(v) : v);
    return r < 1 ? null : r;
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
    logCalories.mutate({ date, kcal, label: trimmed === '' ? null : trimmed, mealNo: mealSlot });
    setAmount('');
    setLabel('');
    setMealSlot(null);
  };

  const bump = (n: number) => {
    // An in-progress expression evaluates first — +200 on "435×5" is 2375.
    const cur = evalEnergyExpression(amount);
    setAmount(String(Math.round((cur ?? 0) + n)));
  };

  const kcalPreview = unit === 1 ? enteredKcal() : null;

  return (
    <GlowCard>
      <SectionLabel size="lg">QUICK LOG</SectionLabel>
      <SegmentedTabs left="KCAL" right="KJ" active={unit} onChange={setUnit} testIDPrefix="fuel-unit" pixelLabels />

      {/* THE NUMBER — first and biggest; everything below it is optional. */}
      <View className="mt-s3 items-center">
        <Text
          className="mb-s1 text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
        >
          {unit === 1 ? 'ENERGY · KJ' : 'ENERGY · KCAL'}
        </Text>
        <NumberField
          value={amount}
          onChange={setAmount}
          step={unit === 1 ? 50 : 10}
          bigStep={unit === 1 ? 500 : 100}
          placeholder={unit === 1 ? 'kJ · maths ok' : 'kcal · maths ok'}
          label={unit === 1 ? 'ENERGY · KJ' : 'ENERGY · KCAL'}
          width={168}
          calculator
          big
          testID="fuel-amount"
        />
        {kcalPreview !== null ? (
          <Text
            className="mt-s1 text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            ≈ {kcalPreview.toLocaleString()} KCAL
          </Text>
        ) : null}
      </View>
      <View className="mt-s2 flex-row flex-wrap justify-center gap-s2">
        {QUICK_ADDS.map((n) => (
          <Chip
            key={n}
            label={`+${n}`}
            active={false}
            onPress={() => bump(n)}
            testID={`fuel-quick-${n}`}
            hitSlop={{ top: 8, bottom: 8 }}
          />
        ))}
      </View>

      {/* THE OPTIONAL DETAIL — quieter than the number above. */}
      <TextInput
        className="mt-s3 min-h-[44px] w-full rounded-md border border-border bg-surface-2 px-s3 text-sm text-text"
        placeholder="Label (optional)"
        placeholderTextColor="#64758f"
        value={label}
        onChangeText={setLabel}
        maxLength={60}
        testID="fuel-label"
      />
      <View className="mt-s3">
        <MealSlotPicker value={mealSlot} onChange={setMealSlot} testIDPrefix="quick-assign" />
        <NeonButton title="LOG IT" onPress={logNow} busy={logCalories.isPending} testID="fuel-log" />
      </View>
    </GlowCard>
  );
}
