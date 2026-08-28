import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { todayIso } from '@/domain/today';
import { cullKey, isCulled } from '@/lab/cull-model';
import { cull, uncull, useCulled } from '@/lab/cull-store';
import { labVariantHref } from '@/lab/links';
import { LAB_PAGES } from '@/lab/registry';
import type { LabPage, LabVariant } from '@/lab/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * PAGE LAB — the gallery, and the lab's front door. One section per page,
 * one card per live design: what it is, OPEN, and CULL when it loses.
 *
 * The index is deliberately an INDEX. You land here, you pick a page, you
 * click into that page's batch of takes and compare them with the tab strip.
 * (The (lab) layout is the gate; by the time this renders, the lab is on.)
 *
 * testID contract (the Playwright tour drives these):
 *   lab-open-<page>-<variant>, lab-cull-<page>-<variant>,
 *   lab-uncull-<page>-<variant>
 */
export default function LabGalleryScreen() {
  const colors = useThemeColors();
  const culled = useCulled();

  // Keys for designs that no longer exist (already deleted in a follow-up
  // commit) are ignored, never shown — the registry is the only truth about
  // what exists, and a stale key must not outlive its variant on screen.
  const pending = LAB_PAGES.flatMap((page) =>
    page.variants
      .filter((variant) => isCulled(culled, page.id, variant.id))
      .map((variant) => ({ page, variant }))
  );

  return (
    <ScreenShell>
      <ScreenHeader kicker="DEV ONLY" title="PAGE LAB" />
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
      >
        MOCK DATA ONLY — every variant runs on the seeded lab athlete.
      </Text>

      {LAB_PAGES.map((page) => {
        const live = page.variants.filter((v) => !isCulled(culled, page.id, v.id));
        return (
          <View key={page.id} className="w-full gap-s3">
            <SectionLabel size="lg">{`${page.title} · ${live.length}`}</SectionLabel>
            {live.length === 0 ? (
              <Text className="text-xs text-text-dim">
                Every take on this page is culled. Restore one below, or fork a new one.
              </Text>
            ) : (
              live.map((variant) => (
                <VariantCard key={variant.id} page={page} variant={variant} />
              ))
            )}
          </View>
        );
      })}

      {pending.length > 0 ? (
        <View className="w-full gap-s3">
          <SectionLabel size="lg">CULLED · PENDING REMOVAL</SectionLabel>
          <Text className="text-xs text-text-dim">
            Hidden on this device only. Deleting them for good is a commit: the variant files, its
            registry-meta entry, its COMPONENTS line.
          </Text>
          {pending.map(({ page, variant }) => (
            <CulledRow key={cullKey(page.id, variant.id)} page={page} variant={variant} />
          ))}
        </View>
      ) : null}
    </ScreenShell>
  );
}

function VariantCard({ page, variant }: { page: LabPage; variant: LabVariant }) {
  const colors = useThemeColors();

  const open = () =>
    router.push(labVariantHref(page.id, variant.id, page.exampleParams?.(todayIso())) as never);

  return (
    <GlowCard>
      <View className="gap-s3">
        <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.text, ...pixelFont() }}>
          {variant.title}
        </Text>
        <Text className="text-xs text-text-dim">{variant.description}</Text>
        <NeonButton title="OPEN" onPress={open} testID={`lab-open-${page.id}-${variant.id}`} />
        {/* Quiet on purpose: culling is a decision, not a convenience, and
            it must never sit at the same weight as OPEN. */}
        <Pressable
          testID={`lab-cull-${page.id}-${variant.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Cull the ${variant.title} design`}
          onPress={() => cull(page.id, variant.id)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 10,
              letterSpacing: 1,
              color: colors['text-mute'],
              ...pixelFont(false),
            }}
          >
            CULL
          </Text>
        </Pressable>
      </View>
    </GlowCard>
  );
}

function CulledRow({ page, variant }: { page: LabPage; variant: LabVariant }) {
  const colors = useThemeColors();
  return (
    <View
      className="w-full flex-row items-center justify-between"
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: colors['text-mute'],
          ...pixelFont(false),
        }}
      >
        {`${page.title} / ${variant.title}`}
      </Text>
      <Pressable
        testID={`lab-uncull-${page.id}-${variant.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Restore the ${variant.title} design`}
        onPress={() => uncull(page.id, variant.id)}
        style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 12 }}
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
          RESTORE
        </Text>
      </Pressable>
    </View>
  );
}
