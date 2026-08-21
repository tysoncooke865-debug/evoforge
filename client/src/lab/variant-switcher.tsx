import { Pressable, ScrollView, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { switcherHref } from './switcher-model';
import type { LabDataMode, LabPage } from './types';

/**
 * The in-page variant TABS — a persistent strip across the top of every lab
 * variant so flipping between takes of the same page is one tap, always
 * visible, browser-tab style. (This replaced the collapsed bottom-right pill
 * on Tyson's brief, 2026-08-21: a switcher you must expand hides the very
 * comparison the lab exists for.)
 *
 * Design constraints, in order:
 *  - it sits IN FLOW above the design (never overlays it): the strip costs
 *    ~44pt of viewport, and in exchange no variant's own bottom-right corner
 *    is ever occluded by lab chrome;
 *  - it is judged NEXT TO designs being compared, so it carries no motion of
 *    its own (no Reanimated — it must also never be the file that trips
 *    verify-motion) and stays visually quiet: dim tabs, one accent
 *    underline for the current take;
 *  - router.replace, not push — flipping six variants must not grow a back
 *    stack the BACK gesture then replays six times;
 *  - page-contract params ride across the swap (switcher-model.ts).
 *
 * testID contract (the Playwright tour drives these):
 *   lab-tab-<page>-<variant>
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
  const insets = useSafeAreaInsets();

  if (page.variants.length < 2) return null;

  const swap = (variantId: string) => {
    if (variantId === current) return;
    router.replace(switcherHref(page.id, variantId, mode, params) as never);
  };

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {page.variants.map((v) => {
          const active = v.id === current;
          return (
            <Pressable
              key={v.id}
              testID={`lab-tab-${page.id}-${v.id}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${v.title} variant`}
              onPress={() => swap(v.id)}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 12,
                borderBottomWidth: 2,
                borderBottomColor: active ? colors.accent : 'transparent',
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
        })}
      </ScrollView>
    </View>
  );
}
