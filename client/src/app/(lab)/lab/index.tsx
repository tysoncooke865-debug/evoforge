import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { todayIso } from '@/domain/today';
import { labVariantHref } from '@/lab/links';
import { LAB_PAGES } from '@/lab/registry';
import type { LabPage, LabVariant } from '@/lab/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * PAGE LAB — the gallery. One section per page, one card per variant:
 * what it is, and OPEN. The (lab) layout is the gate; by the time this
 * renders, the lab is on.
 */
export default function LabGalleryScreen() {
  const colors = useThemeColors();
  return (
    <ScreenShell>
      <ScreenHeader kicker="DEV ONLY" title="PAGE LAB" />
      {LAB_PAGES.map((page) => (
        <View key={page.id} className="w-full gap-s3">
          <SectionLabel size="lg">{page.title}</SectionLabel>
          {page.variants.map((variant) => (
            <VariantCard key={variant.id} page={page} variant={variant} />
          ))}
        </View>
      ))}
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
      >
        MOCK DATA ONLY — every variant runs on the seeded lab athlete.
      </Text>
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
      </View>
    </GlowCard>
  );
}
