import { Text, View } from 'react-native';

import { useMealNames } from '@/data/nutrition';
import { mealSlotName } from '@/domain/nutrition';
import { mealCountOf, useFuelStore } from '@/state/fuel-store';
import { pixelFont } from '@/theme/fonts';
import { Chip } from '@/ui/core/neon-button';

/**
 * ASSIGN TO — the optional meal-slot picker (Tyson 2026-07-19: "optionally
 * prompt the user to input a meal to assign it to… clearly visible but
 * non-invasive"). A chip row over the save button in every calorie-logging
 * surface; nothing is preselected, tapping the active chip unassigns, and an
 * unassigned entry stays a quick-add exactly as before. The slot count is
 * the athlete's own ＋/− MEAL setting.
 */
export function MealSlotPicker({
  value,
  onChange,
  testIDPrefix = 'meal-slot',
}: {
  value: number | null;
  onChange: (slot: number | null) => void;
  testIDPrefix?: string;
}) {
  const storedMealCount = useFuelStore(mealCountOf);
  const customNames = useMealNames().data ?? [];
  // A named slot must always be offerable, even on a device whose local
  // meal count hasn't caught up (names are server truth, count is local).
  const count = Math.max(4, storedMealCount ?? 4, customNames.length);
  return (
    <View className="mb-s3">
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        ASSIGN TO · OPTIONAL
      </Text>
      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
        {Array.from({ length: count }, (_, i) => i + 1).map((slot) => (
          <Chip
            key={slot}
            label={mealSlotName(slot, customNames)}
            active={value === slot}
            onPress={() => onChange(value === slot ? null : slot)}
            testID={`${testIDPrefix}-${slot}`}
            hitSlop={{ top: 8, bottom: 8 }}
          />
        ))}
      </View>
    </View>
  );
}
