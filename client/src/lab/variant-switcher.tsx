import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { switcherHref } from './switcher-model';
import type { LabDataMode, LabPage } from './types';

/**
 * The in-page variant switcher — a floating pill on every lab variant so
 * flipping between takes of the same page never detours through the gallery.
 *
 * Design constraints, in order:
 *  - it is judged NEXT TO designs being compared, so it carries no motion of
 *    its own (plain useState, no Reanimated — it must also never be the file
 *    that trips verify-motion) and sits collapsed in the bottom-right corner;
 *  - pointerEvents="box-none" on every wrapper: only the pill itself eats
 *    taps, the design underneath keeps its whole surface;
 *  - router.replace, not push — flipping six variants must not grow a back
 *    stack the BACK gesture then replays six times;
 *  - page-contract params ride across the swap (switcher-model.ts).
 *
 * testID contract (the Playwright tour drives these):
 *   lab-switcher-toggle
 *   lab-switcher-option-<page>-<variant>
 */
export function LabVariantSwitcher({
  page,
  current,
  mode,
}: {
  page: LabPage;
  current: string;
  mode: LabDataMode;
}) {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const [open, setOpen] = useState(false);

  if (page.variants.length < 2) return null;

  const swap = (variantId: string) => {
    setOpen(false);
    if (variantId === current) return;
    router.replace(switcherHref(page.id, variantId, mode, params) as never);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 12, bottom: 16, alignItems: 'flex-end' }}
    >
      {open
        ? page.variants.map((v) => {
            const active = v.id === current;
            return (
              <Pressable
                key={v.id}
                testID={`lab-switcher-option-${page.id}-${v.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Switch to the ${v.title} variant`}
                onPress={() => swap(v.id)}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                  marginBottom: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.border,
                  backgroundColor: `${colors.surface}f2`,
                }}
              >
                <Text
                  allowFontScaling={false}
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    color: active ? colors.accent : colors['text-dim'],
                    ...pixelFont(false),
                  }}
                >
                  {v.title}
                </Text>
              </Pressable>
            );
          })
        : null}
      <Pressable
        testID="lab-switcher-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          open ? 'Close the variant switcher' : `Variant switcher — showing ${current}`
        }
        onPress={() => setOpen((o) => !o)}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 14,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: `${colors.surface}f2`,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 10,
            letterSpacing: 1,
            color: colors.accent,
            ...pixelFont(false),
          }}
        >
          {open ? 'CLOSE' : `◈ ${current.toUpperCase()}`}
        </Text>
      </Pressable>
    </View>
  );
}
