import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { hitToItem, searchFoods, type FoodHit } from '@/data/food-lookup';
import type { MealItem } from '@/data/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * FUEL — free-text food SEARCH (Open Food Facts). Type, pick, repeat: each tap
 * appends the food to the meal being built (default portion = its serving),
 * and the same confirm sheet then lets you correct grams before saving.
 * Debounced so a fast typist fires one request, not one per keystroke.
 */
export function FoodSearchModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (item: MealItem) => void;
}) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<FoodHit[]>([]);
  // The query the current `hits`/`error` belong to — so a stale result set is
  // never shown (or tapped) under a newer term.
  const [hitsQ, setHitsQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const seq = useRef(0);
  // A query under two chars searches nothing; derived in render (never a
  // setState in the effect body — the results/error/spinner only apply while
  // active AND the hits match the CURRENT term).
  const trimmed = query.trim();
  const active = trimmed.length >= 2;
  const fresh = active && hitsQ === trimmed;

  useEffect(() => {
    if (!active) return;
    const q = trimmed;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await searchFoods(q);
      if (mine !== seq.current) return; // a newer query superseded this one
      setBusy(false);
      setHitsQ(q);
      if ('error' in r) {
        setError(r.error);
        setHits([]);
      } else {
        setError(null);
        setHits(r);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [trimmed, active]);

  const pick = (hit: FoodHit) => {
    onPick(hitToItem(hit));
    setAdded((n) => n + 1);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.8)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="overflow-hidden rounded-t-xl border-t"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: '82%' }}
        >
          <View className="p-s4">
            <Text
              className="mb-s3 text-text"
              allowFontScaling={false}
              style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}
            >
              SEARCH FOODS
            </Text>
            <TextInput
              autoFocus
              className="min-h-[52px] w-full rounded-md border bg-surface-2 px-s3 text-base text-text"
              style={{ borderColor: `${colors.accent}59` }}
              placeholder="e.g. greek yoghurt, banana, chicken breast"
              placeholderTextColor="#64758f"
              value={query}
              onChangeText={setQuery}
              maxLength={60}
              testID="food-search-input"
            />
            {added > 0 ? (
              <Text className="mt-s2 text-2xs text-success" testID="food-search-added">
                ✓ {added} {added === 1 ? 'food' : 'foods'} added — correct the grams on the next screen.
              </Text>
            ) : null}
            {fresh && error ? <Text className="mt-s2 text-2xs text-danger">{error}</Text> : null}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 12, maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
            >
              {active && (busy || !fresh) ? (
                <View className="items-center py-s4">
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}
              {fresh && !busy && hits.length === 0 && !error ? (
                <Text className="py-s3 text-2xs text-text-mute">No matches — try a simpler term.</Text>
              ) : null}
              {(fresh ? hits : []).map((h) => {
                const per = h.per100;
                const serv = h.servingQ ?? 100;
                const servKcal = Math.round((serv * per.kcal) / 100);
                return (
                  <Pressable
                    key={h.key}
                    onPress={() => pick(h)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${h.name}`}
                    testID={`food-hit-${h.key}`}
                    className="mb-s2 flex-row items-center rounded-lg border p-s3"
                    style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)', gap: 10, minHeight: 56 }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text className="text-sm font-bold text-text" numberOfLines={1}>
                        {h.name}
                      </Text>
                      <Text className="text-2xs text-text-mute" numberOfLines={1}>
                        {h.brand ? `${h.brand} · ` : ''}
                        {servKcal} kcal / {serv}g · P{Math.round((serv * per.p) / 100)} C
                        {Math.round((serv * per.c) / 100)} F{Math.round((serv * per.f) / 100)}
                      </Text>
                    </View>
                    <Text className="text-lg text-accent">＋</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View className="mt-s2">
              <NeonButton
                title={added > 0 ? `DONE · REVIEW ${added}` : 'CLOSE'}
                variant={added > 0 ? 'primary' : 'ghost'}
                onPress={onClose}
                testID="food-search-done"
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
