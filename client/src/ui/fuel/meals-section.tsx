import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  useDeleteEntry,
  useMealNames,
  useSaveMealNames,
  type NutritionEntry,
} from '@/data/nutrition';
import {
  canAddMeal,
  canRemoveMeal,
  effectiveMealCount,
  mealMacroTotals,
  mealSlotName,
} from '@/domain/nutrition';
import { mealCountOf, useFuelStore } from '@/state/fuel-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
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
 * entries. DISPLAY-ONLY since 2026-07-19 (Tyson): the per-slot logger is
 * gone — entries arrive via the main input's ASSIGN picker, and delete is
 * the only action here. The ＋/− MEAL footer keeps the 8-slot day — slots
 * past SNACKS number themselves.
 */

const SLOT_ICONS = [PixelSun, PixelBloom, PixelMoon, PixelApple] as const;

export function MealsSection({
  entries,
  consumed,
}: {
  entries: NutritionEntry[];
  /** The whole day's kcal — the heading's right-hand "N KCAL LOGGED". */
  consumed: number;
}) {
  const colors = useThemeColors();
  const deleteEntry = useDeleteEntry();
  const storedMealCount = useFuelStore(mealCountOf);
  const setMealCount = useFuelStore((s) => s.setMealCount);
  const mealCount = effectiveMealCount(storedMealCount, entries);
  const slotTotals = mealMacroTotals(entries, mealCount);
  const [openMeal, setOpenMeal] = useState<number | null>(null);
  // 8.5 (056): the athlete's own slot names + the rename affordance.
  const customNames = useMealNames().data ?? [];
  const saveNames = useSaveMealNames();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const commitRename = () => {
    if (renaming === null) return;
    const clean = nameDraft.trim().slice(0, 24);
    const next = [...customNames];
    while (next.length < renaming) next.push(null);
    // An emptied field restores the default name for that slot.
    next[renaming - 1] = clean === '' ? null : clean;
    saveNames.mutate(next);
    setRenaming(null);
    setNameDraft('');
  };

  const timeOf = (ts: string): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <View className="w-full">
      <View className="mb-s2 flex-row items-end justify-between">
        {/* FUEL v2: the section reads LAST on the page now — the title
            carries SectionLabel-lg weight (inlined: the row also holds the
            kcal counter, which the component form can't). */}
        <Text
          className="text-text"
          allowFontScaling={false}
          style={{
            fontSize: 17,
            lineHeight: 22,
            letterSpacing: 0.5,
            textShadowColor: 'rgba(34,211,238,0.4)',
            textShadowRadius: 12,
            ...pixelFont(),
          }}
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
                onPress={() => setOpenMeal(open ? null : slot)}
                accessibilityRole="button"
                accessibilityLabel={`${mealSlotName(slot, customNames)}: ${totals.kcal} kilocalories, ${totals.protein} grams protein. ${open ? 'Collapse' : 'Expand'}.`}
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
                    numberOfLines={1}
                    style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                  >
                    {mealSlotName(slot, customNames)}
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
                  {/* No ＋ any more (Tyson 2026-07-19): slots DISPLAY what the
                      main input filed into them; logging lives up there. */}
                  <Text className="text-sm text-accent">{open ? '▾' : '▸'}</Text>
                </View>
              </Pressable>

              {open ? (
                <View className="px-s3 pb-s3">
                  {/* Display-only (Tyson 2026-07-19): the per-slot logger is
                      gone — every entry arrives via the main input's ASSIGN
                      picker. Delete stays; a wrong entry must be removable. */}
                  {slotEntries.length === 0 ? (
                    <Text className="text-2xs text-text-mute">
                      Nothing filed here yet — log from SCAN A MEAL or QUICK LOG above and assign
                      it to {mealSlotName(slot, customNames)}.
                    </Text>
                  ) : null}
                  {/* 8.5: rename the slot — the athlete's own meal types. */}
                  {renaming === slot ? (
                    <View className="mt-s2 flex-row items-center gap-s2">
                      <TextInput
                        className="min-h-[40px] flex-1 rounded-md border border-border bg-surface-2 px-s2 text-sm text-text"
                        value={nameDraft}
                        onChangeText={setNameDraft}
                        onSubmitEditing={commitRename}
                        placeholder={mealSlotName(slot)}
                        placeholderTextColor="#64758f"
                        autoFocus
                        maxLength={24}
                        testID={`fuel-meal-${slot}-name-input`}
                      />
                      <Pressable
                        onPress={commitRename}
                        accessibilityRole="button"
                        accessibilityLabel="save the meal name"
                        className="items-center justify-center rounded-md border px-s3"
                        style={{ minHeight: 40, borderColor: `${colors.accent}59` }}
                        testID={`fuel-meal-${slot}-name-save`}
                      >
                        <Text className="text-2xs text-accent" style={{ letterSpacing: 1 }}>
                          SAVE
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setRenaming(slot);
                        setNameDraft(
                          typeof customNames[slot - 1] === 'string' ? (customNames[slot - 1] as string) : ''
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`rename ${mealSlotName(slot, customNames)}`}
                      className="mt-s1 self-start"
                      style={{ minHeight: 32, justifyContent: 'center' }}
                      testID={`fuel-meal-${slot}-rename`}
                    >
                      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
                        ✎ RENAME
                      </Text>
                    </Pressable>
                  )}
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
