import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  useDeleteEntry,
  useLogCalories,
  type NutritionEntry,
} from '@/data/nutrition';
import {
  canAddMeal,
  canRemoveMeal,
  effectiveMealCount,
  mealMacroTotals,
  mealSlotName,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { mealCountOf, useFuelStore } from '@/state/fuel-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Field } from '@/ui/core/field';
import {
  PixelApple,
  PixelBloom,
  PixelFork,
  PixelMoon,
  PixelSun,
} from '@/ui/core/pixel-icons';

/**
 * FUEL_REDESIGN — TODAY'S MEALS: the numbered slots wearing their day names
 * (position IS meaning — slot 1 is breakfast). Collapsed rows stay compact
 * (icon · name/time · summary · one control); tapping expands the slot's
 * entries and the same per-slot logger as before. The ＋/− MEAL footer keeps
 * the 8-slot day — slots past SNACKS number themselves.
 */

const SLOT_ICONS = [PixelSun, PixelBloom, PixelMoon, PixelApple] as const;

export function MealsSection({
  date,
  entries,
  consumed,
}: {
  date: string;
  entries: NutritionEntry[];
  /** The whole day's kcal — the heading's right-hand "N KCAL LOGGED". */
  consumed: number;
}) {
  const colors = useThemeColors();
  const logCalories = useLogCalories();
  const deleteEntry = useDeleteEntry();
  const storedMealCount = useFuelStore(mealCountOf);
  const setMealCount = useFuelStore((s) => s.setMealCount);
  const mealCount = effectiveMealCount(storedMealCount, entries);
  const slotTotals = mealMacroTotals(entries, mealCount);
  const [openMeal, setOpenMeal] = useState<number | null>(null);
  const [mealAmount, setMealAmount] = useState('');

  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Same validation and toast as the quick log — one rulebook.
  const logMeal = (slot: number) => {
    const v = pyFloat(mealAmount);
    // Round first, THEN judge: 0.4 rounds to 0 and 0 violates kcal > 0.
    const kcal = v === null || Math.round(v) < 1 ? null : Math.round(v);
    if (kcal === null || kcal > 6000) {
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT A MEAL',
        subtitle: kcal === null ? 'Enter an amount above zero.' : 'Entries cap at 6,000 kcal.',
      });
      return;
    }
    logCalories.mutate({ date, kcal, label: null, mealNo: slot });
    setMealAmount('');
  };

  return (
    <View className="w-full">
      <View className="mb-s2 flex-row items-end justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          TODAY&apos;S MEALS
        </Text>
        <Text
          className="text-accent"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
          testID="fuel-kcal-logged"
        >
          {consumed.toLocaleString()} KCAL LOGGED
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {Array.from({ length: mealCount }, (_, i) => i + 1).map((slot) => {
          const slotEntries = entries.filter((e) => e.meal_no === slot);
          const totals = slotTotals[slot - 1] ?? { kcal: 0, protein: 0 };
          const open = openMeal === slot;
          const logged = slotEntries.length > 0;
          const tint =
            [colors.legendary, colors.epic, colors.rare, colors.success][slot - 1] ??
            colors.accent;
          const Icon = SLOT_ICONS[slot - 1] ?? PixelFork;
          const firstLabel = slotEntries.find((e) => e.label)?.label ?? null;
          const summary = !logged
            ? slot === 4
              ? 'Add any extras'
              : 'Not logged'
            : slotEntries.length === 1
              ? (firstLabel ?? 'Logged')
              : `${slotEntries.length} items logged`;
          return (
            <View
              key={slot}
              className="rounded-lg border"
              style={{
                borderColor: open ? `${tint}59` : colors.border,
                backgroundColor: 'rgba(13,21,36,0.6)',
              }}
            >
              <Pressable
                onPress={() => {
                  setOpenMeal(open ? null : slot);
                  setMealAmount('');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${mealSlotName(slot)}: ${totals.kcal} kilocalories, ${totals.protein} grams protein. ${open ? 'Collapse' : 'Expand'}.`}
                testID={`fuel-meal-${slot}`}
                className="flex-row items-center p-s3"
                style={{ minHeight: 60, gap: 12 }}
              >
                <View
                  className="items-center justify-center rounded-md border"
                  style={{
                    width: 38,
                    height: 38,
                    borderColor: `${tint}59`,
                    backgroundColor: `${tint}14`,
                  }}
                >
                  <Icon size={17} color={tint} />
                </View>
                <View style={{ width: 86 }}>
                  <Text
                    className="text-text"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                  >
                    {mealSlotName(slot)}
                  </Text>
                  <Text className="mt-s1 text-2xs text-text-mute">
                    {logged ? timeOf(slotEntries[0].timestamp) : '--:--'}
                  </Text>
                </View>
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text
                    className={logged ? 'text-sm text-text' : 'text-sm text-text-mute'}
                    numberOfLines={1}
                  >
                    {summary}
                  </Text>
                  <Text className="mt-s1 text-2xs text-text-mute">
                    <Text style={{ color: logged ? colors.accent : colors['text-mute'] }}>
                      {totals.kcal.toLocaleString()} kcal
                    </Text>
                    {' · '}
                    {totals.protein}g protein
                  </Text>
                </View>
                <View
                  className="items-center justify-center rounded-md border"
                  style={{ width: 34, height: 34, borderColor: colors.border }}
                >
                  <Text className="text-sm text-accent">{open ? '▾' : logged ? '▸' : '＋'}</Text>
                </View>
              </Pressable>

              {open ? (
                <View className="px-s3 pb-s3">
                  {slotEntries.map((e) => (
                    <View key={e.id} className="flex-row items-center">
                      <View className="flex-1">
                        <Text className="text-2xs text-text-mute" numberOfLines={1}>
                          {timeOf(e.timestamp)}
                          {e.label ? ` · ${e.label}` : ''}
                        </Text>
                      </View>
                      <Text
                        className="text-accent"
                        allowFontScaling={false}
                        style={{ fontSize: 14, ...pixelFont() }}
                      >
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
                      accessibilityLabel={`log to ${mealSlotName(slot)}`}
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
      </View>

      {/* One VISIBLE tap per action — − MEAL is absent, not disabled, at the floor. */}
      <View className="mt-s1 flex-row items-center">
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
    </View>
  );
}
