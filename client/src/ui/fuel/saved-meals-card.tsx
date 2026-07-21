import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useDeleteSavedMeal, useLogMeal, useSavedMeals, type SavedMeal } from '@/data/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';
import { MealSlotPicker } from '@/ui/fuel/meal-slot-picker';

/**
 * SAVED MEALS (081, FUEL v2): the meals saved from the scan/describe confirm
 * sheet, re-logged with ONE TAP. Renders nothing while the list is empty —
 * the ☆ SAVE FOR LATER affordance in the confirm sheet is the discovery
 * surface; an empty pitch card here would be noise.
 *
 * + LOG logs immediately (the meter must move under the thumb — useLogMeal's
 * caps and totals maths already hold, since a saved meal IS a scanned meal's
 * items). The ▾ expander offers the slot picker and delete; an unassigned
 * log stays a quick-add, exactly the QuickLog convention.
 */
export function SavedMealsCard({ date }: { date: string }) {
  const colors = useThemeColors();
  const meals = useSavedMeals().data ?? [];
  const logMeal = useLogMeal();
  const deleteMeal = useDeleteSavedMeal();
  const [openId, setOpenId] = useState<string | null>(null);
  // Per-open-card slot choice; resets when the expander moves or logs.
  const [slot, setSlot] = useState<number | null>(null);

  if (meals.length === 0) return null;

  const logIt = (meal: SavedMeal, mealNo: number | null) => {
    logMeal.mutate({ date, items: meal.items, mealNo });
    setOpenId(null);
    setSlot(null);
  };

  return (
    <GlowCard>
      <SectionLabel size="lg">SAVED MEALS</SectionLabel>
      {meals.map((m) => {
        const open = openId === m.id;
        return (
          <View
            key={m.id}
            className="mb-s2 rounded-lg border px-s3 py-s2"
            style={{ borderColor: open ? `${colors.accent}59` : colors.border }}
          >
            <View className="flex-row items-center">
              <Pressable
                onPress={() => {
                  setOpenId(open ? null : m.id);
                  setSlot(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${open ? 'collapse' : 'expand'} ${m.name}`}
                className="flex-1 flex-row items-center"
                style={{ minHeight: 44, gap: 8 }}
                testID={`saved-meal-open-${m.id}`}
              >
                <Text className="text-text-mute" style={{ fontSize: 10 }}>
                  {open ? '▾' : '▸'}
                </Text>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-text" numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text className="text-2xs text-text-mute" numberOfLines={1}>
                    {Math.round(Number(m.kcal)).toLocaleString()} kcal · P{Math.round(Number(m.protein_g))}{' '}
                    C{Math.round(Number(m.carbs_g))} F{Math.round(Number(m.fat_g))}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => logIt(m, open ? slot : null)}
                disabled={logMeal.isPending}
                accessibilityRole="button"
                accessibilityLabel={`log ${m.name} today`}
                className="ml-s2 items-center justify-center rounded-md border px-s3"
                style={{
                  minHeight: 44,
                  borderColor: `${colors.accent}80`,
                  backgroundColor: 'rgba(34,211,238,0.08)',
                  opacity: logMeal.isPending ? 0.5 : 1,
                }}
                testID={`saved-meal-log-${m.id}`}
              >
                <Text
                  className="text-accent"
                  allowFontScaling={false}
                  style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                >
                  ＋ LOG
                </Text>
              </Pressable>
            </View>
            {open ? (
              <View className="mt-s2 border-t border-border-soft pt-s2">
                <MealSlotPicker value={slot} onChange={setSlot} testIDPrefix={`saved-meal-slot-${m.id}`} />
                <Pressable
                  onPress={() => deleteMeal.mutate(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`delete saved meal ${m.name}`}
                  className="items-center justify-center"
                  style={{ minHeight: 44 }}
                  testID={`saved-meal-delete-${m.id}`}
                >
                  <Text
                    className="text-text-mute"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                  >
                    ✕ DELETE SAVED MEAL
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </GlowCard>
  );
}
