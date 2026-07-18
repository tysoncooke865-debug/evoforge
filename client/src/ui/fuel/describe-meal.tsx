import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { describeMeal, type MealItem } from '@/data/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * FUEL — describe a meal or paste a recipe in plain text; the AI extracts the
 * foods and portions and the deterministic table prices them. Two quick modes
 * (a sentence vs a full recipe) share one call; the result rides the SAME
 * confirm sheet as scan/barcode/search — an estimate is a prefill, never a
 * write.
 */
export function DescribeMealModal({
  onClose,
  onItems,
}: {
  onClose: () => void;
  onItems: (items: MealItem[], notes: string) => void;
}) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'describe' | 'recipe'>('describe');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const t = text.trim();
    if (t.length < 3) return;
    setBusy(true);
    setError(null);
    const r = await describeMeal(t, mode);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onItems(r.items, r.notes);
  };

  const placeholder =
    mode === 'recipe'
      ? 'Paste a recipe — ingredients and, if you like, how many servings.\n\ne.g. 500g chicken, 2 cups rice, 1 tbsp oil, 1 onion — serves 4'
      : 'Describe what you ate in a sentence.\n\ne.g. two scrambled eggs, a slice of toast with butter, and a banana';

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.8)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="overflow-hidden rounded-t-xl border-t"
          style={{ borderColor: `${colors.epic}40`, backgroundColor: colors.surface, maxHeight: '82%' }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            <Text
              className="mb-s3 text-text"
              allowFontScaling={false}
              style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}
            >
              DESCRIBE A MEAL
            </Text>

            <View className="mb-s3 flex-row" style={{ gap: 8 }}>
              <ModeTab label="DESCRIBE" active={mode === 'describe'} onPress={() => setMode('describe')} />
              <ModeTab label="RECIPE" active={mode === 'recipe'} onPress={() => setMode('recipe')} />
            </View>

            <TextInput
              autoFocus
              multiline
              className="w-full rounded-md border bg-surface-2 px-s3 py-s3 text-base text-text"
              style={{ borderColor: `${colors.epic}59`, minHeight: 120, textAlignVertical: 'top' }}
              placeholder={placeholder}
              placeholderTextColor="#64758f"
              value={text}
              onChangeText={setText}
              maxLength={1500}
              testID="describe-input"
            />
            <Text className="mt-s1 text-2xs text-text-mute">
              {mode === 'recipe'
                ? 'For a recipe with a serving count, the Oracle returns ONE serving.'
                : 'The AI names the foods; the numbers come from a fixed nutrition table.'}
            </Text>
            {error ? (
              <Text className="mt-s2 text-2xs text-danger" testID="describe-error">
                {error}
              </Text>
            ) : null}

            <View className="mt-s3">
              <NeonButton
                title={busy ? 'READING…' : mode === 'recipe' ? 'CALCULATE RECIPE' : 'ESTIMATE MEAL'}
                variant="epic"
                onPress={() => void submit()}
                busy={busy}
                disabled={text.trim().length < 3}
                testID="describe-submit"
              />
            </View>
            <View className="mt-s2">
              <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="describe-close" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ModeTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="flex-1 items-center justify-center rounded-md border py-s2"
      style={{
        minHeight: 44,
        borderColor: active ? `${colors.epic}8c` : colors.border,
        backgroundColor: active ? 'rgba(168,85,247,0.12)' : colors['surface-2'],
      }}
      testID={`describe-mode-${label.toLowerCase()}`}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 11, letterSpacing: 1, color: active ? colors.epic : colors['text-dim'], ...pixelFont(false) }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
