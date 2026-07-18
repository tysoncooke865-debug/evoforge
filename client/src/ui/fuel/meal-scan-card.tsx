import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { pickPhoto } from '@/data/ai';
import type { BarcodeProduct } from '@/data/food-lookup';
import {
  scanMeal,
  scanTotals,
  useLogMeal,
  type MealItem,
} from '@/data/nutrition';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { KeyPad } from '@/ui/core/number-field';
import { PixelBarcode, PixelCamera, PixelPencil } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { BarcodeScanModal } from '@/ui/fuel/barcode-scan';
import { DescribeMealModal } from '@/ui/fuel/describe-meal';
import { FoodSearchModal } from '@/ui/fuel/food-search';
import { MealSlotPicker } from '@/ui/fuel/meal-slot-picker';

/**
 * FUEL_REDESIGN — the AI meal scan, promoted to the page's hero action with
 * the purple AI treatment and scan-frame corners. Two doors, one contract:
 * photo → meal-scan edge fn, or barcode → Open Food Facts — both land in the
 * SAME confirm sheet (grams editable, items removable, deterministic totals)
 * and save through the SAME useLogMeal mutation. An estimate is a prefill,
 * never a write.
 */
export function AIMealScanCard({ date }: { date: string }) {
  const colors = useThemeColors();
  const [scanBusy, setScanBusy] = useState(false);
  const [items, setItems] = useState<MealItem[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gramsFor, setGramsFor] = useState<number | null>(null);
  const [mealSlot, setMealSlot] = useState<number | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const saveMeal = useLogMeal();

  // Search appends one food at a time to the meal being built.
  const addFood = (item: MealItem) => {
    setError(null);
    setTitle(null);
    setItems((cur) => [...(cur ?? []), item]);
  };
  // Describe/recipe returns a whole item list at once.
  const onDescribed = (list: MealItem[], notes: string) => {
    setDescribeOpen(false);
    setError(null);
    setTitle(notes ? notes.slice(0, 40) : null);
    setItems(list);
  };

  const runScan = async () => {
    setError(null);
    const uri = await pickPhoto();
    if (!uri) return;
    setScanBusy(true);
    const r = await scanMeal(uri);
    setScanBusy(false);
    if ('error' in r) setError(r.error);
    else {
      setTitle(null);
      setItems(r.items);
    }
  };

  const onProduct = (p: BarcodeProduct) => {
    setBarcodeOpen(false);
    setError(null);
    setTitle(p.title);
    setItems([p.item]);
  };

  const corner = (pos: object) => (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: 18, height: 18, borderColor: `${colors.epic}8c`, ...pos }}
    />
  );

  return (
    <GlowCard glow={colors.epic}>
      {/* Scan-frame corners INSIDE the clip — GlowCard is overflow-hidden,
          so negative offsets would never render. They sit in the padding
          zone (card padding 20, corners at 8). */}
      {corner({ top: 8, left: 8, borderTopWidth: 2, borderLeftWidth: 2 })}
      {corner({ top: 8, right: 8, borderTopWidth: 2, borderRightWidth: 2 })}
      {corner({ bottom: 8, left: 8, borderBottomWidth: 2, borderLeftWidth: 2 })}
      {corner({ bottom: 8, right: 8, borderBottomWidth: 2, borderRightWidth: 2 })}

      {items === null ? (
        <>
          <View className="flex-row" style={{ gap: 14 }}>
            {/* The scanner frame — the AI's viewport, not a stock photo. */}
            <View
              className="items-center justify-center rounded-lg border"
              style={{
                width: 92,
                height: 92,
                borderColor: `${colors.epic}59`,
                backgroundColor: 'rgba(168,85,247,0.07)',
              }}
            >
              <PixelCamera size={30} color={colors.epic} />
              <View
                className="mt-s2 rounded-pill border px-s2"
                style={{ borderColor: `${colors.epic}8c`, paddingVertical: 2 }}
              >
                <Text
                  className="text-epic"
                  allowFontScaling={false}
                  style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
                >
                  AI SCAN
                </Text>
              </View>
            </View>
            <View className="flex-1">
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 20,
                  lineHeight: 26,
                  color: colors.text,
                  textShadowColor: 'rgba(168,85,247,0.5)',
                  textShadowRadius: 12,
                  ...pixelFont(),
                }}
              >
                AI MEAL SCAN ✦
              </Text>
              <Text className="mt-s1 text-2xs text-text-dim">
                Photograph your meal. AI identifies foods, estimates portions, and you confirm
                before saving.
              </Text>
            </View>
          </View>
          <View className="mt-s3">
            <NeonButton
              title={scanBusy ? 'READING THE PLATE…' : 'SCAN A MEAL'}
              variant="epic"
              icon={<PixelCamera size={15} color="#f8f4ff" />}
              onPress={() => void runScan()}
              busy={scanBusy}
              testID="meal-scan"
            />
          </View>
          {/* The other doors — all land in the same confirm sheet. */}
          <View className="mt-s2 flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton
                title="SEARCH"
                variant="ghost"
                onPress={() => setSearchOpen(true)}
                testID="food-search-open"
              />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton
                title="BARCODE"
                variant="ghost"
                icon={<PixelBarcode size={14} color={colors.accent} />}
                onPress={() => setBarcodeOpen(true)}
                testID="barcode-open"
              />
            </View>
          </View>
          <View className="mt-s2">
            <NeonButton
              title="DESCRIBE A MEAL / RECIPE"
              variant="ghost"
              icon={<PixelPencil size={13} color={colors.accent} />}
              onPress={() => setDescribeOpen(true)}
              testID="describe-open"
            />
          </View>
          {error ? <Text className="mt-s2 text-2xs text-danger">{error}</Text> : null}
        </>
      ) : (
        <>
          <Text
            className="mb-s3 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            {title ? title.toUpperCase().slice(0, 32) : 'CONFIRM MEAL'}
          </Text>
          {items.map((it, i) => {
            const kcal = Math.round((it.grams * it.per100.kcal) / 100);
            return (
              <View key={`${it.name}:${i}`} className="mb-s2 flex-row items-center gap-s2">
                <View className="flex-1">
                  <Text className="text-sm font-bold text-text" numberOfLines={1}>
                    {it.name}
                    {it.source === 'ai' ? <Text className="text-2xs text-warn">  AI EST.</Text> : null}
                  </Text>
                  <Text className="text-2xs text-text-mute">
                    {kcal} kcal · P{Math.round((it.grams * it.per100.p) / 100)} C
                    {Math.round((it.grams * it.per100.c) / 100)} F
                    {Math.round((it.grams * it.per100.f) / 100)}
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
                  onPress={() => setItems(items.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`remove ${it.name}`}
                  className="items-center justify-center"
                  style={{ minWidth: 44, minHeight: 44 }}
                  testID={`meal-remove-${i}`}
                >
                  <Text className="text-sm text-text-mute">✕</Text>
                </Pressable>
              </View>
            );
          })}
          {(() => {
            const t = scanTotals(items);
            return (
              <View
                className="mb-s3 flex-row items-center justify-between rounded-lg border px-s3 py-s2"
                style={{ borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.06)' }}
              >
                <Text className="text-sm font-bold text-epic" testID="meal-total">
                  {t.kcal} kcal
                </Text>
                <Text className="text-2xs text-text-dim">
                  P {Math.round(t.p)}g · C {Math.round(t.c)}g · F {Math.round(t.f)}g
                </Text>
              </View>
            );
          })()}
          <MealSlotPicker value={mealSlot} onChange={setMealSlot} testIDPrefix="meal-assign" />
          <NeonButton
            title="SAVE MEAL"
            variant="epic"
            onPress={() =>
              saveMeal.mutate(
                { date, items, mealNo: mealSlot },
                {
                  onSuccess: () => {
                    setItems(null);
                    setTitle(null);
                    setMealSlot(null);
                  },
                }
              )
            }
            busy={saveMeal.isPending}
            disabled={items.length === 0}
            testID="meal-save"
          />
          <View className="mt-s2">
            <NeonButton
              title="DISCARD"
              variant="ghost"
              onPress={() => {
                setItems(null);
                setTitle(null);
                setMealSlot(null);
              }}
              testID="meal-discard"
            />
          </View>
        </>
      )}

      {gramsFor !== null && items ? (
        <KeyPad
          label={`${items[gramsFor]?.name?.toUpperCase().slice(0, 18) ?? 'PORTION'} · GRAMS`}
          initial={String(items[gramsFor]?.grams ?? '')}
          integer
          tint={colors.epic}
          onDone={(v) => {
            // An emptied keypad keeps the old grams — never silently 1 g.
            const raw = pyFloat(v);
            if (raw === null || raw <= 0) return;
            const n = Math.min(2000, Math.trunc(raw));
            setItems(items.map((it, j) => (j === gramsFor ? { ...it, grams: n } : it)));
          }}
          onClose={() => setGramsFor(null)}
        />
      ) : null}

      {barcodeOpen ? (
        <BarcodeScanModal onClose={() => setBarcodeOpen(false)} onProduct={onProduct} />
      ) : null}

      {searchOpen ? (
        <FoodSearchModal onClose={() => setSearchOpen(false)} onPick={addFood} />
      ) : null}

      {describeOpen ? (
        <DescribeMealModal onClose={() => setDescribeOpen(false)} onItems={onDescribed} />
      ) : null}
    </GlowCard>
  );
}
