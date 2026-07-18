import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { pickPhoto } from '@/data/ai';
import type { BarcodeProduct } from '@/data/food-lookup';
import {
  describeMeal,
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
  // 8.3: the optional AI hint — revealed only after SCAN A MEAL is pressed
  // (screen-crowding rule), rides the scan call, identification only.
  const [hintOpen, setHintOpen] = useState(false);
  const [hint, setHint] = useState('');
  // 8.2: correcting the AI — which item's NAME is being edited, and which is
  // re-estimating.
  const [nameFor, setNameFor] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [reestimating, setReestimating] = useState<number | null>(null);
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
    const r = await scanMeal(uri, hint);
    setScanBusy(false);
    setHintOpen(false);
    setHint('');
    if ('error' in r) setError(r.error);
    else {
      setTitle(null);
      setItems(r.items);
    }
  };

  // 8.2: re-price ONE renamed line through the meal-scan text mode — the
  // user's grams stay theirs; only the identification + per-100g move.
  const reestimate = async (i: number) => {
    if (!items || reestimating !== null) return;
    const it = items[i];
    setReestimating(i);
    const r = await describeMeal(`${it.grams} g ${it.name}`);
    setReestimating(null);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    const fresh = r.items[0];
    if (!fresh) return;
    setError(null);
    setItems((cur) =>
      (cur ?? []).map((x, j) =>
        j === i
          ? { ...fresh, name: it.name, grams: it.grams, edited: false }
          : x
      )
    );
  };

  const commitRename = () => {
    if (nameFor === null) return;
    const clean = nameDraft.trim().slice(0, 60);
    setItems((cur) =>
      (cur ?? []).map((x, j) => (j === nameFor && clean !== '' && clean !== x.name ? { ...x, name: clean, edited: true } : x))
    );
    setNameFor(null);
    setNameDraft('');
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
              title={scanBusy ? 'READING THE PLATE…' : hintOpen ? 'CHOOSE PHOTO' : 'SCAN A MEAL'}
              variant="epic"
              icon={<PixelCamera size={15} color="#f8f4ff" />}
              onPress={() => {
                // First press reveals the optional hint (8.3 — it must not
                // crowd the card before the athlete commits to a scan);
                // second press picks the photo, hint or no hint.
                if (!hintOpen && !scanBusy) setHintOpen(true);
                else void runScan();
              }}
              busy={scanBusy}
              testID="meal-scan"
            />
            {hintOpen && !scanBusy ? (
              <View className="mt-s2">
                <TextInput
                  className="min-h-[44px] w-full rounded-md border border-border bg-surface-2 px-s3 text-sm text-text"
                  placeholder="Optional hint — e.g. “that's turkey, not chicken”"
                  placeholderTextColor="#64758f"
                  value={hint}
                  onChangeText={setHint}
                  maxLength={200}
                  testID="meal-scan-hint"
                />
                <Pressable
                  onPress={() => {
                    setHintOpen(false);
                    setHint('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="cancel the scan"
                  className="mt-s1 self-center px-s2"
                  style={{ minHeight: 32, justifyContent: 'center' }}
                  testID="meal-scan-hint-cancel"
                >
                  <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
                    CANCEL
                  </Text>
                </Pressable>
              </View>
            ) : null}
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
              <View key={i} className="mb-s2 flex-row items-center gap-s2">
                <View className="flex-1">
                  {nameFor === i ? (
                    <TextInput
                      className="min-h-[40px] w-full rounded-md border border-border bg-surface-2 px-s2 text-sm text-text"
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      onSubmitEditing={commitRename}
                      onBlur={commitRename}
                      autoFocus
                      maxLength={60}
                      testID={`meal-name-input-${i}`}
                    />
                  ) : (
                    <Pressable
                      onPress={() => {
                        // 8.2: the AI got the food wrong? Tap the name, fix it.
                        setNameFor(i);
                        setNameDraft(it.name);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`edit the name of ${it.name}`}
                      testID={`meal-name-${i}`}
                    >
                      <Text className="text-sm font-bold text-text" numberOfLines={1}>
                        {it.name}
                        {it.source === 'ai' ? <Text className="text-2xs text-warn">  AI EST.</Text> : null}
                        <Text className="text-2xs text-text-mute">  ✎</Text>
                      </Text>
                    </Pressable>
                  )}
                  <Text className="text-2xs text-text-mute">
                    {kcal} kcal · P{Math.round((it.grams * it.per100.p) / 100)} C
                    {Math.round((it.grams * it.per100.c) / 100)} F
                    {Math.round((it.grams * it.per100.f) / 100)}
                  </Text>
                  {it.edited ? (
                    <Pressable
                      onPress={() => void reestimate(i)}
                      disabled={reestimating !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`re-estimate ${it.name}`}
                      testID={`meal-reestimate-${i}`}
                      style={{ minHeight: 28, justifyContent: 'center', opacity: reestimating !== null && reestimating !== i ? 0.4 : 1 }}
                    >
                      <Text className="text-2xs text-warn" numberOfLines={2}>
                        Macros still from the original guess ·{' '}
                        <Text className="text-epic">
                          {reestimating === i ? 'RE-ESTIMATING…' : '✦ RE-ESTIMATE'}
                        </Text>
                      </Text>
                    </Pressable>
                  ) : null}
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
