import { Pressable, ScrollView, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { isCulled } from './cull-model';
import { useCulled } from './cull-store';
import { switcherHref } from './switcher-model';
import type { LabPage } from './types';

/**
 * The lab's chrome bar — the way back to the gallery, and the variant TABS.
 *
 * A persistent strip across the top of every lab variant so flipping between
 * takes of the same page is one tap, always visible, browser-tab style.
 * (This replaced the collapsed bottom-right pill on Tyson's brief,
 * 2026-08-21: a switcher you must expand hides the very comparison the lab
 * exists for.)
 *
 * v2.1 (2026-08-28) renders the strip even for a page holding ONE variant.
 * It used to return null there, which left a lab page with no route back to
 * the gallery except the browser's own BACK — the lab stopped looking like a
 * lab and started looking like the app with a strange URL.
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
 *   lab-gallery, lab-tab-<page>-<variant>
 */
export function LabVariantSwitcher({ page, current }: { page: LabPage; current: string }) {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const culled = useCulled();

  // A culled variant leaves the strip — except the one being VIEWED, which
  // must keep its tab or the bar would claim you are somewhere you are not.
  const tabs = page.variants.filter(
    (v) => v.id === current || !isCulled(culled, page.id, v.id)
  );

  const swap = (variantId: string) => {
    if (variantId === current) return;
    router.replace(switcherHref(page.id, variantId, params) as never);
  };

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'stretch',
      }}
    >
      {/* Outside the ScrollView so it never scrolls away: from any variant,
          the gallery is always exactly one tap. replace, not back — the
          history behind a variant is other variants (see swap above), so a
          pop would land on whichever take was flipped through last. */}
      <Pressable
        testID="lab-gallery"
        accessibilityRole="button"
        accessibilityLabel="Back to the lab gallery"
        onPress={() => router.replace('/lab' as never)}
        style={{
          minHeight: 44,
          minWidth: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
          borderRightWidth: 1,
          borderRightColor: colors.border,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 10,
            letterSpacing: 1,
            color: colors['text-dim'],
            ...pixelFont(false),
          }}
        >
          {'← LAB'}
        </Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {tabs.map((v) => {
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
