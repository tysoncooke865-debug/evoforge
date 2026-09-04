import { Pressable, ScrollView, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { switcherHref } from './switcher-model';
import type { LabBatch, LabPage } from './types';

/**
 * The lab's chrome bar — the way back to the gallery, and the variant TABS.
 *
 * A persistent strip across the top of every lab variant so flipping between
 * takes is one tap, always visible, browser-tab style. (This replaced the
 * collapsed bottom-right pill on Tyson's brief, 2026-08-21: a switcher you
 * must expand hides the very comparison the lab exists for.)
 *
 * v3 (2026-09-04) the strip is BATCH-SCOPED: CURRENT is always the first
 * tab, followed by the takes of the ONE batch being reviewed — never a
 * different round. Comparing a redesign against the deployed page is the
 * whole point, so CURRENT is one tap from every take; comparing two BATCHES
 * is a gallery decision, not a tab. With no batch in scope (a bare
 * /lab/<page>/baseline deep link, or a stale ?batch) the strip is
 * [LAB | CURRENT]. The strip stopped consulting the cull store: culling is
 * batch-level now, and a batch you are LOOKING AT shows its full strip —
 * the old "except the one being viewed" rule, generalized.
 *
 * Design constraints, in order:
 *  - it sits IN FLOW above the design (never overlays it);
 *  - it is judged NEXT TO designs being compared, so it carries no motion of
 *    its own (no Reanimated — it must also never be the file that trips
 *    verify-motion) and stays visually quiet: dim tabs, one accent
 *    underline for the current take;
 *  - router.replace, not push — flipping variants must not grow a back
 *    stack the BACK gesture then replays;
 *  - page-contract params AND the batch scope ride across the swap
 *    (switcher-model.ts).
 *
 * testID contract (the Playwright tour drives these):
 *   lab-gallery, lab-tab-<page>-<variant>
 */
export function LabVariantSwitcher({
  page,
  current,
  batch,
}: {
  page: LabPage;
  current: string;
  batch: LabBatch | null;
}) {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  // CURRENT leads, always — every take is judged against the deployed page.
  const tabs = [page.baseline, ...(batch?.variants ?? [])];

  const swap = (variantId: string) => {
    if (variantId === current) return;
    router.replace(switcherHref(page.id, variantId, params, batch?.number) as never);
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
